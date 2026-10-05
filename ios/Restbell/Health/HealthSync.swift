import Foundation
import HealthKit
import RestbellKit

/// Imports Apple Watch workouts and daily health metrics into Restbell.
/// Every trigger (HealthKit background delivery, background refresh, the nightly reconcile, the Shortcuts
/// automation, opening the app) runs the same idempotent sync: workouts by anchor, the last N days of metrics
/// re-sent in full so gaps fill themselves, weigh-ins from a smart scale.
actor HealthSync {
    static let shared = HealthSync()
    let store = HKHealthStore()

    enum Trigger: String, Codable, Sendable {
        case launch, foreground, backgroundRefresh, nightly, observer, shortcut, manual
        var label: String {
            switch self {
            case .launch: "App launch"
            case .foreground: "Opened the app"
            case .backgroundRefresh: "Background refresh"
            case .nightly: "Nightly reconcile"
            case .observer: "Health update"
            case .shortcut: "Shortcuts automation"
            case .manual: "Sync now"
            }
        }
    }

    struct Report: Codable, Identifiable, Sendable {
        var at: Date
        var trigger: Trigger
        var workouts = 0
        var deleted = 0
        var days = 0
        var weighIns = 0
        var error: String?
        var id: Date { at }
        var summary: String {
            if let error { return "Health sync failed: \(error)" }
            let w = workouts == 1 ? "1 workout" : "\(workouts) workouts"
            return "Synced \(w) and \(days) days of health data."
        }
    }

    /// What the athlete allows Restbell to read; each can be switched off in More → Apple Health.
    enum Group: String, CaseIterable, Identifiable, Sendable {
        case workouts, activity, heart, sleep, body
        var id: String { rawValue }
        var title: String {
            switch self {
            case .workouts: "Workouts and heart rate"
            case .activity: "Activity rings, steps, energy"
            case .heart: "Resting HR, HRV, VO2 max, breathing"
            case .sleep: "Sleep and wrist temperature"
            case .body: "Weight and body fat"
            }
        }
        var symbol: String {
            switch self {
            case .workouts: "figure.run"
            case .activity: "flame"
            case .heart: "heart.fill"
            case .sleep: "bed.double.fill"
            case .body: "scalemass.fill"
            }
        }
        var key: String { "health.group.\(rawValue)" }
    }

    nonisolated static var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }
    nonisolated static var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: "health.enabled") }
        set { UserDefaults.standard.set(newValue, forKey: "health.enabled") }
    }
    nonisolated static func isOn(_ g: Group) -> Bool { UserDefaults.standard.object(forKey: g.key) as? Bool ?? true }
    nonisolated static func set(_ g: Group, _ on: Bool) { UserDefaults.standard.set(on, forKey: g.key) }
    nonisolated static var writeWorkouts: Bool {
        get { UserDefaults.standard.bool(forKey: "health.write.workouts") }
        set { UserDefaults.standard.set(newValue, forKey: "health.write.workouts") }
    }
    nonisolated static var writeMeals: Bool {
        get { UserDefaults.standard.bool(forKey: "health.write.meals") }
        set { UserDefaults.standard.set(newValue, forKey: "health.write.meals") }
    }

    private var observing = false
    private var running = false
    private var lastMetricsSync = Date.distantPast

    // MARK: Types

    static let bpm = HKUnit.count().unitDivided(by: .minute())

    static let readTypes: Set<HKObjectType> = {
        var s: Set<HKObjectType> = [HKObjectType.workoutType(), HKObjectType.activitySummaryType(), HKCategoryType(.sleepAnalysis)]
        let quantities: [HKQuantityTypeIdentifier] = [
            .heartRate, .activeEnergyBurned, .basalEnergyBurned, .distanceWalkingRunning, .distanceCycling, .distanceSwimming,
            .stepCount, .flightsClimbed, .appleExerciseTime, .appleStandTime, .timeInDaylight,
            .restingHeartRate, .walkingHeartRateAverage, .heartRateVariabilitySDNN, .respiratoryRate, .oxygenSaturation,
            .appleSleepingWristTemperature, .vo2Max, .heartRateRecoveryOneMinute,
            .runningPower, .runningSpeed, .runningStrideLength, .runningGroundContactTime, .runningVerticalOscillation,
            .bodyMass, .bodyFatPercentage, .workoutEffortScore, .estimatedWorkoutEffortScore,
        ]
        for q in quantities { s.insert(HKQuantityType(q)) }
        return s
    }()

    static let shareTypes: Set<HKSampleType> = [HKObjectType.workoutType(), HKQuantityType(.dietaryEnergyConsumed), HKQuantityType(.dietaryProtein)]

    func requestAuthorization() async throws {
        try await store.requestAuthorization(toShare: Self.shareTypes, read: Self.readTypes)
        Self.enabled = true
        await start()
    }

    // MARK: Background delivery

    /// Set up observer queries and background delivery. Must run at every launch for background delivery to keep working.
    func start() async {
        guard Self.isAvailable, Self.enabled, !observing, !SharedStore.demo, SharedStore.serverURL != nil else { return }
        observing = true
        let watched: [(HKSampleType, HKUpdateFrequency)] = [
            (HKObjectType.workoutType(), .immediate),
            (HKCategoryType(.sleepAnalysis), .hourly),
            (HKQuantityType(.restingHeartRate), .hourly),
            (HKQuantityType(.heartRateVariabilitySDNN), .hourly),
            (HKQuantityType(.bodyMass), .hourly),
            (HKQuantityType(.stepCount), .hourly),
            (HKQuantityType(.activeEnergyBurned), .hourly),
        ]
        for (type, frequency) in watched {
            let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, error in
                guard error == nil else { completion(); return }
                Task {
                    _ = await HealthSync.shared.sync(trigger: .observer)
                    completion()
                }
            }
            store.execute(query)
            // Fails without the background-delivery entitlement (some free accounts); the other triggers still sync.
            try? await store.enableBackgroundDelivery(for: type, frequency: frequency)
        }
        _ = await sync(trigger: .launch)
    }

    // MARK: Sync

    @discardableResult
    func sync(trigger: Trigger, days: Int = 7) async -> Report {
        var report = Report(at: Date(), trigger: trigger)
        guard Self.isAvailable, Self.enabled, !SharedStore.demo, let api = SharedStore.client() else {
            report.error = "Apple Health is not connected"
            return report
        }
        guard !running else { return report }
        running = true
        defer { running = false }
        do {
            if Self.isOn(.workouts) {
                let (added, deleted) = try await syncWorkouts(api)
                report.workouts = added
                report.deleted = deleted
            }
            // Observer wake-ups can come in bursts; metrics are re-sent at most every 15 minutes from them.
            if trigger != .observer || Date().timeIntervalSince(lastMetricsSync) > 900 {
                report.days = try await syncMetrics(api, days: days)
                lastMetricsSync = Date()
            }
            if Self.isOn(.body) { report.weighIns = try await syncWeighIns(api, days: days) }
        } catch is CancellationError {
            report.error = "Stopped by iOS before it finished"
        } catch {
            report.error = error.localizedDescription
        }
        Self.record(report)
        return report
    }

    // MARK: Workouts

    static let anchorKey = "health.workoutAnchor"

    func syncWorkouts(_ api: APIClient) async throws -> (Int, Int) {
        let anchor = UserDefaults.standard.data(forKey: Self.anchorKey).flatMap { try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: $0) }
        // The first import takes the last 30 days, not years of history.
        let since = Calendar.current.date(byAdding: .day, value: -30, to: Date())!
        let predicate = anchor == nil ? HKQuery.predicateForSamples(withStart: since, end: nil) : nil
        let descriptor = HKAnchoredObjectQueryDescriptor(predicates: [.workout(predicate)], anchor: anchor)
        let result = try await descriptor.result(for: store)

        var uploads: [WorkoutUpload] = []
        for workout in result.addedSamples {
            try Task.checkCancellation()
            uploads.append(await upload(for: workout))
        }
        var i = 0
        while i < uploads.count {
            _ = try await api.uploadWorkouts(Array(uploads[i..<min(i + 5, uploads.count)]))
            i += 5
        }
        var deleted = 0
        for object in result.deletedObjects {
            if (try? await api.deleteWorkout(externalId: object.uuid.uuidString))?.deleted == true { deleted += 1 }
        }
        // Only move the anchor once the server has everything.
        if let data = try? NSKeyedArchiver.archivedData(withRootObject: result.newAnchor, requiringSecureCoding: true) {
            UserDefaults.standard.set(data, forKey: Self.anchorKey)
        }
        return (uploads.count, deleted)
    }

    func upload(for w: HKWorkout) async -> WorkoutUpload {
        let activity = w.workoutActivityType
        var u = WorkoutUpload(externalId: w.uuid.uuidString, type: Self.name(for: activity), start: ISOTime.string(w.startDate), end: ISOTime.string(w.endDate))
        let minutes = w.duration / 60
        u.durationMin = (minutes * 10).rounded() / 10
        let active = w.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie())
        u.kcal = active.map { $0.rounded() }
        if let distanceType = Self.distanceType(for: activity),
           let meters = w.statistics(for: HKQuantityType(distanceType))?.sumQuantity()?.doubleValue(for: .meter()), meters > 0 {
            u.distanceKm = (meters / 10).rounded() / 100
        }
        if let hr = w.statistics(for: HKQuantityType(.heartRate)) {
            u.avgHr = hr.averageQuantity()?.doubleValue(for: Self.bpm).rounded()
            u.maxHr = hr.maximumQuantity()?.doubleValue(for: Self.bpm).rounded()
        }
        if let elevation = w.metadata?[HKMetadataKeyElevationAscended] as? HKQuantity {
            u.elevationM = elevation.doubleValue(for: .meter()).rounded()
        }

        // Heart rate through one minute after the end, for zones and recovery.
        let hrSamples = (try? await samples(.heartRate, from: w.startDate, to: w.endDate.addingTimeInterval(120))) ?? []
        let points = hrSamples.map { HealthMath.HRSample(time: $0.startDate, bpm: $0.quantity.doubleValue(for: Self.bpm)) }
        u.samples = points.filter { $0.time <= w.endDate }.map { WorkoutUpload.Sample(t: ISOTime.string($0.time), hr: $0.bpm) }
        u.hrRecovery = HealthMath.hrRecovery(samples: points, workoutEnd: w.endDate)
        u.effort = await effort(for: w)

        var details = WorkoutDetails()
        let basal = w.statistics(for: HKQuantityType(.basalEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie())
        if let active { details.totalKcal = (active + (basal ?? 0)).rounded() }
        if activity == .running || activity == .walking || activity == .hiking {
            let steps = await stat(w, .stepCount, .cumulativeSum, .count())
            details.stepCount = steps
            details.cadenceSpm = HealthMath.cadence(steps: steps, minutes: minutes)
            details.powerW = await stat(w, .runningPower, .discreteAverage, .watt()).map { $0.rounded() }
            details.speedKmh = await stat(w, .runningSpeed, .discreteAverage, HKUnit.meter().unitDivided(by: .second())).map { ($0 * 36).rounded() / 10 }
            details.strideM = await stat(w, .runningStrideLength, .discreteAverage, .meter()).map { ($0 * 100).rounded() / 100 }
            details.groundContactMs = await stat(w, .runningGroundContactTime, .discreteAverage, .secondUnit(with: .milli)).map { $0.rounded() }
            details.verticalOscillationCm = await stat(w, .runningVerticalOscillation, .discreteAverage, .meterUnit(with: .centi)).map { ($0 * 10).rounded() / 10 }
            let distance = (try? await samples(.distanceWalkingRunning, from: w.startDate, to: w.endDate)) ?? []
            let splits = HealthMath.splits(from: distance.map { .init(start: $0.startDate, end: $0.endDate, meters: $0.quantity.doubleValue(for: .meter())) }, workoutStart: w.startDate)
            if !splits.isEmpty { details.splits = splits }
        }
        u.details = details
        return u
    }

    /// A workout statistic, from the workout itself when the Watch recorded it, else from samples in its time range.
    func stat(_ w: HKWorkout, _ id: HKQuantityTypeIdentifier, _ option: HKStatisticsOptions, _ unit: HKUnit) async -> Double? {
        let type = HKQuantityType(id)
        let pick: (HKStatistics) -> HKQuantity? = { option == .cumulativeSum ? $0.sumQuantity() : $0.averageQuantity() }
        if let s = w.statistics(for: type), let q = pick(s) { return q.doubleValue(for: unit) }
        let predicate = HKQuery.predicateForSamples(withStart: w.startDate, end: w.endDate, options: .strictStartDate)
        let descriptor = HKStatisticsQueryDescriptor(predicate: .quantitySample(type: type, predicate: predicate), options: option)
        guard let s = try? await descriptor.result(for: store), let q = pick(s) else { return nil }
        return q.doubleValue(for: unit)
    }

    func samples(_ id: HKQuantityTypeIdentifier, from: Date, to: Date) async throws -> [HKQuantitySample] {
        let predicate = HKQuery.predicateForSamples(withStart: from, end: to)
        let descriptor = HKSampleQueryDescriptor(predicates: [.quantitySample(type: HKQuantityType(id), predicate: predicate)], sortDescriptors: [SortDescriptor(\.startDate)])
        return try await descriptor.result(for: store)
    }

    /// The effort rating the athlete gave on the Watch (1–10), else Apple's estimate.
    func effort(for w: HKWorkout) async -> Double? {
        for id in [HKQuantityTypeIdentifier.workoutEffortScore, .estimatedWorkoutEffortScore] {
            let predicate = HKQuery.predicateForWorkoutEffortSamplesRelated(workout: w, activity: nil)
            let descriptor = HKSampleQueryDescriptor(predicates: [.quantitySample(type: HKQuantityType(id), predicate: predicate)], sortDescriptors: [])
            if let s = try? await descriptor.result(for: store).first {
                return (s.quantity.doubleValue(for: .appleEffortScore()) * 10).rounded() / 10
            }
        }
        return nil
    }

    static func distanceType(for a: HKWorkoutActivityType) -> HKQuantityTypeIdentifier? {
        switch a {
        case .running, .walking, .hiking: .distanceWalkingRunning
        case .cycling: .distanceCycling
        case .swimming: .distanceSwimming
        default: nil
        }
    }

    /// The names Apple's Shortcuts used, so workouts imported before and after the app line up.
    static func name(for a: HKWorkoutActivityType) -> String {
        let caseName: String
        switch a {
        case .running: caseName = "running"
        case .walking: caseName = "walking"
        case .hiking: caseName = "hiking"
        case .cycling: caseName = "cycling"
        case .swimming: caseName = "swimming"
        case .rowing: caseName = "rowing"
        case .elliptical: caseName = "elliptical"
        case .stairClimbing: caseName = "stairClimbing"
        case .traditionalStrengthTraining: caseName = "traditionalStrengthTraining"
        case .functionalStrengthTraining: caseName = "functionalStrengthTraining"
        case .highIntensityIntervalTraining: caseName = "highIntensityIntervalTraining"
        case .coreTraining: caseName = "coreTraining"
        case .crossTraining: caseName = "crossTraining"
        case .mixedCardio: caseName = "mixedCardio"
        case .yoga: caseName = "yoga"
        case .pilates: caseName = "pilates"
        case .flexibility: caseName = "flexibility"
        case .cooldown: caseName = "cooldown"
        case .preparationAndRecovery: caseName = "preparationAndRecovery"
        case .mindAndBody: caseName = "mindAndBody"
        case .jumpRope: caseName = "jumpRope"
        case .kickboxing: caseName = "kickboxing"
        case .boxing: caseName = "boxing"
        case .martialArts: caseName = "martialArts"
        case .climbing: caseName = "climbing"
        case .tennis: caseName = "tennis"
        case .pickleball: caseName = "pickleball"
        case .soccer: caseName = "soccer"
        case .basketball: caseName = "basketball"
        case .golf: caseName = "golf"
        case .cardioDance: caseName = "cardioDance"
        case .socialDance: caseName = "socialDance"
        case .downhillSkiing: caseName = "downhillSkiing"
        case .crossCountrySkiing: caseName = "crossCountrySkiing"
        case .snowboarding: caseName = "snowboarding"
        case .stepTraining: caseName = "stepTraining"
        case .swimBikeRun: caseName = "swimBikeRun"
        default: caseName = "other"
        }
        return HealthMath.displayName(caseName: caseName)
    }

    // MARK: Daily metrics

    func syncMetrics(_ api: APIClient, days: Int) async throws -> Int {
        let cal = Calendar.current
        let todayStart = cal.startOfDay(for: Date())
        let start = cal.date(byAdding: .day, value: -(days - 1), to: todayStart)!
        var byDay: [String: [String: Double]] = [:]
        func put(_ date: Date, _ key: String, _ value: Double?) {
            guard let value, value.isFinite, date >= start else { return }
            byDay[DayString.of(date), default: [:]][key] = value
        }

        if Self.isOn(.activity) {
            let sums: [(HKQuantityTypeIdentifier, String, HKUnit)] = [
                (.stepCount, "steps", .count()), (.activeEnergyBurned, "active_kcal", .kilocalorie()), (.basalEnergyBurned, "basal_kcal", .kilocalorie()),
                (.appleExerciseTime, "exercise_min", .minute()), (.distanceWalkingRunning, "distance_km", .meterUnit(with: .kilo)),
                (.flightsClimbed, "flights", .count()), (.timeInDaylight, "daylight_min", .minute()),
            ]
            for (id, key, unit) in sums {
                for s in (try? await daily(id, .cumulativeSum, from: start)) ?? [] {
                    put(s.startDate, key, s.sumQuantity().map { (($0.doubleValue(for: unit)) * 100).rounded() / 100 })
                }
            }
            for summary in (try? await activitySummaries(from: start)) ?? [] {
                guard let date = summary.dateComponents(for: cal).date else { continue }
                put(date, "move_goal_kcal", summary.activeEnergyBurnedGoal.doubleValue(for: .kilocalorie()))
                put(date, "exercise_goal_min", summary.exerciseTimeGoal?.doubleValue(for: .minute()))
                put(date, "stand_hours", summary.appleStandHours.doubleValue(for: .count()))
                put(date, "stand_goal_hours", summary.standHoursGoal?.doubleValue(for: .count()))
            }
        }

        if Self.isOn(.heart) {
            let averages: [(HKQuantityTypeIdentifier, String, HKUnit, Double)] = [
                (.restingHeartRate, "resting_hr", Self.bpm, 1), (.walkingHeartRateAverage, "walking_hr", Self.bpm, 1),
                (.heartRateVariabilitySDNN, "hrv_ms", .secondUnit(with: .milli), 1), (.respiratoryRate, "respiratory_rate", Self.bpm, 1),
                (.oxygenSaturation, "spo2_pct", .percent(), 100), (.vo2Max, "vo2max", HKUnit(from: "ml/kg*min"), 1),
                (.heartRateRecoveryOneMinute, "cardio_recovery", Self.bpm, 1),
            ]
            for (id, key, unit, scale) in averages {
                for s in (try? await daily(id, .discreteAverage, from: start)) ?? [] {
                    put(s.startDate, key, s.averageQuantity().map { ($0.doubleValue(for: unit) * scale * 10).rounded() / 10 })
                }
            }
        }

        if Self.isOn(.sleep) {
            let sleep = (try? await sleepSamples(from: start.addingTimeInterval(-86400))) ?? []
            var day = start
            while day <= todayStart {
                if let night = HealthMath.sleepNight(sleep, wakeDay: day) {
                    for (k, v) in night.metrics { put(day, k, v) }
                }
                day = cal.date(byAdding: .day, value: 1, to: day)!
            }
            // Wrist temperature as a deviation from the athlete's own recent nights, whatever HealthKit stores.
            let tempStart = cal.date(byAdding: .day, value: -35, to: start)!
            let temps = ((try? await daily(.appleSleepingWristTemperature, .discreteAverage, from: tempStart)) ?? [])
                .compactMap { s in s.averageQuantity().map { (s.startDate, $0.doubleValue(for: .degreeCelsius())) } }
            for (i, (date, value)) in temps.enumerated() where date >= start {
                let prior = temps[max(0, i - 28)..<i].map(\.1)
                if prior.count >= 5 { put(date, "wrist_temp_delta", ((value - prior.reduce(0, +) / Double(prior.count)) * 100).rounded() / 100) }
            }
        }

        let payload = byDay.map { MetricsDay(date: $0.key, metrics: HealthMath.sanitized($0.value)) }.filter { !$0.metrics.isEmpty }.sorted { $0.date < $1.date }
        guard !payload.isEmpty else { return 0 }
        _ = try await api.putMetrics(payload)
        return payload.count
    }

    func daily(_ id: HKQuantityTypeIdentifier, _ options: HKStatisticsOptions, from start: Date) async throws -> [HKStatistics] {
        let type = HKQuantityType(id)
        let descriptor = HKStatisticsCollectionQueryDescriptor(
            predicate: .quantitySample(type: type, predicate: HKQuery.predicateForSamples(withStart: start, end: nil)),
            options: options, anchorDate: start, intervalComponents: DateComponents(day: 1))
        return try await descriptor.result(for: store).statistics()
    }

    func activitySummaries(from start: Date) async throws -> [HKActivitySummary] {
        let cal = Calendar.current
        var from = cal.dateComponents([.era, .year, .month, .day], from: start)
        var to = cal.dateComponents([.era, .year, .month, .day], from: Date())
        from.calendar = cal
        to.calendar = cal
        let predicate = HKQuery.predicate(forActivitySummariesBetweenStart: from, end: to)
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKActivitySummaryQuery(predicate: predicate) { _, summaries, error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: summaries ?? []) }
            }
            store.execute(query)
        }
    }

    func sleepSamples(from start: Date) async throws -> [HealthMath.SleepSample] {
        let predicate = HKQuery.predicateForSamples(withStart: start, end: nil)
        let descriptor = HKSampleQueryDescriptor(predicates: [.categorySample(type: HKCategoryType(.sleepAnalysis), predicate: predicate)], sortDescriptors: [SortDescriptor(\.startDate)])
        return try await descriptor.result(for: store).compactMap { s in
            let stage: HealthMath.SleepStage
            switch HKCategoryValueSleepAnalysis(rawValue: s.value) {
            case .inBed: stage = .inBed
            case .asleepUnspecified: stage = .asleep
            case .asleepCore: stage = .core
            case .asleepDeep: stage = .deep
            case .asleepREM: stage = .rem
            case .awake: stage = .awake
            default: return nil
            }
            return HealthMath.SleepSample(start: s.startDate, end: s.endDate, stage: stage)
        }
    }

    // MARK: Weigh-ins

    func syncWeighIns(_ api: APIClient, days: Int) async throws -> Int {
        let start = Calendar.current.date(byAdding: .day, value: -days, to: Date())!
        let weights = (try? await samples(.bodyMass, from: start, to: Date())) ?? []
        let fats = (try? await samples(.bodyFatPercentage, from: start, to: Date())) ?? []
        // The last reading of each day.
        var latest: [String: HKQuantitySample] = [:]
        for s in weights where s.sourceRevision.source.bundleIdentifier != Bundle.main.bundleIdentifier {
            latest[DayString.of(s.startDate)] = s
        }
        var fatByDay: [String: Double] = [:]
        for s in fats { fatByDay[DayString.of(s.startDate)] = s.quantity.doubleValue(for: .percent()) * 100 }
        let sentKey = "health.sentWeighIns"
        var sent = Set(UserDefaults.standard.stringArray(forKey: sentKey) ?? [])
        var count = 0
        for (day, s) in latest.sorted(by: { $0.key < $1.key }) {
            let kg = (s.quantity.doubleValue(for: .gramUnit(with: .kilo)) * 10).rounded() / 10
            let fat = fatByDay[day].map { ($0 * 10).rounded() / 10 }
            let key = "\(day):\(kg):\(fat ?? 0)"
            guard !sent.contains(key) else { continue }
            _ = try await api.addCheckin(.init(date: day, weightKg: kg, bodyFatPct: fat, source: "healthkit"))
            sent.insert(key)
            count += 1
        }
        UserDefaults.standard.set(Array(sent.suffix(200)), forKey: sentKey)
        return count
    }

    // MARK: Write-back (optional)

    /// Save a finished strength session as a workout, unless the Watch already recorded one at that time.
    func saveStrengthWorkout(start: Date, end: Date) async {
        guard Self.isAvailable, Self.writeWorkouts, end > start else { return }
        let predicate = HKQuery.predicateForSamples(withStart: start.addingTimeInterval(-600), end: end.addingTimeInterval(600))
        let existing = (try? await HKSampleQueryDescriptor(predicates: [.workout(predicate)], sortDescriptors: []).result(for: store)) ?? []
        guard existing.isEmpty else { return }
        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor
        let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: .local())
        do {
            try await builder.beginCollection(at: start)
            try await builder.endCollection(at: end)
            _ = try await builder.finishWorkout()
        } catch {
            // Not authorized to write workouts: nothing to do.
        }
    }

    nonisolated func saveMealIfEnabled(kcal: Double, proteinG: Double, name: String) {
        guard Self.isAvailable, Self.writeMeals else { return }
        Task { await self.saveMeal(kcal: kcal, proteinG: proteinG, name: name) }
    }

    func saveMeal(kcal: Double, proteinG: Double, name: String) async {
        let now = Date()
        let meta: [String: Any] = [HKMetadataKeyFoodType: name]
        let energy = HKQuantitySample(type: HKQuantityType(.dietaryEnergyConsumed), quantity: HKQuantity(unit: .kilocalorie(), doubleValue: kcal), start: now, end: now, metadata: meta)
        let protein = HKQuantitySample(type: HKQuantityType(.dietaryProtein), quantity: HKQuantity(unit: .gram(), doubleValue: proteinG), start: now, end: now, metadata: meta)
        let food = HKCorrelation(type: HKCorrelationType(.food), start: now, end: now, objects: [energy, protein], metadata: meta)
        try? await store.save(food)
    }

    // MARK: Sync log

    static let logKey = "health.syncLog"

    nonisolated static func record(_ report: Report) {
        var log = reports()
        log.insert(report, at: 0)
        UserDefaults.standard.set(try? JSONEncoder().encode(Array(log.prefix(25))), forKey: logKey)
    }

    nonisolated static func reports() -> [Report] {
        UserDefaults.standard.data(forKey: logKey).flatMap { try? JSONDecoder().decode([Report].self, from: $0) } ?? []
    }
}
