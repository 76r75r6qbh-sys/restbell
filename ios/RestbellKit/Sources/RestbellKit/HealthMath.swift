import Foundation

/// Pure helpers behind the Apple Health import: no HealthKit types, so they are unit-tested on any platform.
public enum HealthMath {
    /// "traditionalStrengthTraining" → "Traditional Strength Training", the names Apple's Shortcuts used before.
    public static func displayName(caseName: String) -> String {
        var words: [String] = []
        var current = ""
        for ch in caseName {
            if ch.isUppercase, !current.isEmpty {
                words.append(current)
                current = ""
            }
            current.append(ch)
        }
        if !current.isEmpty { words.append(current) }
        return words.map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
    }

    public struct DistanceSample: Sendable {
        public var start: Date
        public var end: Date
        public var meters: Double
        public init(start: Date, end: Date, meters: Double) { self.start = start; self.end = end; self.meters = meters }
    }

    /// Whole-kilometer splits from distance samples: the time each km boundary was crossed,
    /// interpolated inside the sample that crossed it. A last partial km is included when at least 200 m.
    public static func splits(from samples: [DistanceSample], workoutStart: Date) -> [Split] {
        let sorted = samples.sorted { $0.start < $1.start }
        var out: [Split] = []
        var covered = 0.0
        var lastBoundaryTime = workoutStart
        var nextBoundary = 1000.0
        for s in sorted where s.meters > 0 {
            let duration = s.end.timeIntervalSince(s.start)
            while covered + s.meters >= nextBoundary {
                let fraction = (nextBoundary - covered) / s.meters
                let t = s.start.addingTimeInterval(duration * fraction)
                out.append(Split(km: 1, sec: (t.timeIntervalSince(lastBoundaryTime) * 10).rounded() / 10))
                lastBoundaryTime = t
                nextBoundary += 1000
            }
            covered += s.meters
        }
        let rest = covered - (nextBoundary - 1000)
        if rest >= 200, let lastEnd = sorted.last?.end {
            out.append(Split(km: (rest / 10).rounded() / 100, sec: (lastEnd.timeIntervalSince(lastBoundaryTime) * 10).rounded() / 10))
        }
        return out
    }

    public struct HRSample: Sendable {
        public var time: Date
        public var bpm: Double
        public init(time: Date, bpm: Double) { self.time = time; self.bpm = bpm }
    }

    /// One-minute heart-rate recovery: the heart rate over the last 15 s of the workout minus the
    /// reading closest to one minute after the end (accepted between 50 and 90 s). Nil without both.
    public static func hrRecovery(samples: [HRSample], workoutEnd: Date) -> Double? {
        let atEnd = samples.filter { $0.time <= workoutEnd && $0.time >= workoutEnd.addingTimeInterval(-15) }
        let endHr = atEnd.isEmpty
            ? samples.filter { $0.time <= workoutEnd }.max { $0.time < $1.time }?.bpm
            : atEnd.map(\.bpm).reduce(0, +) / Double(atEnd.count)
        let after = samples
            .filter { let d = $0.time.timeIntervalSince(workoutEnd); return d >= 50 && d <= 90 }
            .min { abs($0.time.timeIntervalSince(workoutEnd) - 60) < abs($1.time.timeIntervalSince(workoutEnd) - 60) }
        guard let endHr, let after, endHr > after.bpm else { return nil }
        return (endHr - after.bpm).rounded()
    }

    public enum SleepStage: Sendable { case inBed, asleep, core, deep, rem, awake }

    public struct SleepSample: Sendable {
        public var start: Date
        public var end: Date
        public var stage: SleepStage
        public init(start: Date, end: Date, stage: SleepStage) { self.start = start; self.end = end; self.stage = stage }
    }

    public struct SleepNight: Equatable, Sendable {
        public var asleepMin: Double
        public var deepMin: Double
        public var coreMin: Double
        public var remMin: Double
        public var awakeMin: Double
        public var inBedMin: Double
        /// Minutes from midnight of the wake-up day; negative when asleep before midnight.
        public var bedtimeMin: Double?
        public var wakeMin: Double?

        public var metrics: [String: Double] {
            var m: [String: Double] = ["sleep_min": asleepMin.rounded()]
            if deepMin + coreMin + remMin > 0 {
                m["sleep_deep_min"] = deepMin.rounded()
                m["sleep_core_min"] = coreMin.rounded()
                m["sleep_rem_min"] = remMin.rounded()
            }
            if awakeMin > 0 { m["sleep_awake_min"] = awakeMin.rounded() }
            if inBedMin > 0 { m["in_bed_min"] = inBedMin.rounded() }
            if let bedtimeMin { m["bedtime_min"] = bedtimeMin.rounded() }
            if let wakeMin { m["wake_min"] = wakeMin.rounded() }
            return m
        }
    }

    /// Total length of the union of intervals, so overlapping samples from the Watch and the phone count once.
    public static func unionMinutes(_ intervals: [(Date, Date)]) -> Double {
        let sorted = intervals.filter { $0.1 > $0.0 }.sorted { $0.0 < $1.0 }
        var total = 0.0
        var current: (Date, Date)?
        for iv in sorted {
            if let c = current, iv.0 <= c.1 {
                current = (c.0, max(c.1, iv.1))
            } else {
                if let c = current { total += c.1.timeIntervalSince(c.0) }
                current = iv
            }
        }
        if let c = current { total += c.1.timeIntervalSince(c.0) }
        return total / 60
    }

    /// The night that ends on `day`: samples between 18:00 the evening before and 18:00 on the day.
    public static func sleepNight(_ samples: [SleepSample], wakeDay dayStart: Date) -> SleepNight? {
        let from = dayStart.addingTimeInterval(-6 * 3600)
        let to = dayStart.addingTimeInterval(18 * 3600)
        let night = samples.compactMap { s -> SleepSample? in
            let a = max(s.start, from), b = min(s.end, to)
            return b > a ? SleepSample(start: a, end: b, stage: s.stage) : nil
        }
        let asleepStages: [SleepStage] = [.asleep, .core, .deep, .rem]
        let asleep = night.filter { asleepStages.contains($0.stage) }
        guard !asleep.isEmpty else { return nil }
        func minutes(_ stage: SleepStage) -> Double { unionMinutes(night.filter { $0.stage == stage }.map { ($0.start, $0.end) }) }
        let first = asleep.map(\.start).min()!
        let last = asleep.map(\.end).max()!
        return SleepNight(
            asleepMin: unionMinutes(asleep.map { ($0.start, $0.end) }),
            deepMin: minutes(.deep),
            coreMin: minutes(.core),
            remMin: minutes(.rem),
            awakeMin: minutes(.awake),
            inBedMin: unionMinutes(night.filter { $0.stage == .inBed }.map { ($0.start, $0.end) }),
            bedtimeMin: (first.timeIntervalSince(dayStart) / 60).rounded(),
            wakeMin: (last.timeIntervalSince(dayStart) / 60).rounded()
        )
    }

    /// Steps per minute over the workout's moving time.
    public static func cadence(steps: Double?, minutes: Double?) -> Double? {
        guard let steps, let minutes, minutes > 0, steps > 0 else { return nil }
        return (steps / minutes).rounded()
    }

    /// Server metric ranges (src/metrics.js): values outside are dropped before upload instead of failing the batch.
    public static let metricRanges: [String: ClosedRange<Double>] = [
        "steps": 0...200_000, "active_kcal": 0...20_000, "basal_kcal": 0...10_000, "exercise_min": 0...1440, "stand_hours": 0...24,
        "move_goal_kcal": 0...20_000, "exercise_goal_min": 0...1440, "stand_goal_hours": 0...24, "distance_km": 0...500, "flights": 0...1000,
        "daylight_min": 0...1440, "resting_hr": 20...200, "walking_hr": 30...220, "hrv_ms": 1...400, "respiratory_rate": 4...60,
        "spo2_pct": 50...100, "wrist_temp_delta": -5...5, "vo2max": 10...100, "cardio_recovery": 0...120, "sleep_min": 0...1440,
        "sleep_deep_min": 0...1440, "sleep_core_min": 0...1440, "sleep_rem_min": 0...1440, "sleep_awake_min": 0...1440,
        "in_bed_min": 0...1440, "bedtime_min": -720...1440, "wake_min": 0...1440,
    ]

    public static func sanitized(_ metrics: [String: Double]) -> [String: Double] {
        metrics.filter { key, value in value.isFinite && (metricRanges[key]?.contains(value) ?? false) }
    }
}
