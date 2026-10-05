import SwiftUI
import RestbellKit

struct MoreView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink { TrendsView() } label: { Label("Trends", systemImage: "chart.xyaxis.line") }
                    NavigationLink { HistoryView() } label: { Label("History", systemImage: "clock.arrow.circlepath") }
                    Button { model.showWeighIn = true } label: { Label("Weigh In", systemImage: "scalemass") }
                }
                Section {
                    NavigationLink { HealthStatusView() } label: {
                        Label {
                            VStack(alignment: .leading) {
                                Text("Apple Health")
                                if let last = HealthSync.reports().first {
                                    Text("Last sync \(last.at.formatted(.relative(presentation: .named)))").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        } icon: { Image(systemName: "heart.fill").foregroundStyle(.pink) }
                    }
                    NavigationLink { SettingsView() } label: { Label("Targets & Notifications", systemImage: "slider.horizontal.3") }
                }
                Section {
                    LabeledContent("Server", value: model.isDemo ? "Demo data" : (SharedStore.serverURL?.host() ?? "—"))
                    Button("Sign Out", role: .destructive) { model.signOut() }
                } footer: {
                    Text("Widgets, quick actions and Siri use the same server. Long-press the app icon to log a favorite.")
                }
            }
            .navigationTitle("More")
        }
    }
}

// MARK: - Trends

struct TrendsView: View {
    @Environment(AppModel.self) private var model
    enum Range: Int, CaseIterable, Identifiable {
        case week = 7, month = 30, halfYear = 182
        var id: Int { rawValue }
        var title: String { switch self { case .week: "1W"; case .month: "1M"; case .halfYear: "6M" } }
    }
    @State private var range: Range = .month
    @State private var page: MetricsPage?
    @State private var checkins: [Checkin] = []
    @State private var runs: [Workout] = []

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Picker("Range", selection: $range) {
                    ForEach(Range.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                if let page {
                    TrendCharts(page: page, checkins: checkins.filter { $0.date >= page.from }, runs: runs.filter { $0.date >= page.from })
                } else {
                    ProgressView().padding(.top, 60)
                }
            }
            .padding()
        }
        .groupedBackground()
        .navigationTitle("Trends")
        .task(id: range) { await load() }
    }

    func load() async {
        guard let api = model.api else { return }
        let to = DayString.today()
        let from = DayString.adding(-(range.rawValue - 1), to: to)
        page = try? await api.metrics(from: from, to: to)
        checkins = (try? await api.checkins().checkins) ?? []
        runs = ((try? await api.history(limit: 200).workouts) ?? []).filter { $0.type == "Running" }
    }
}

// MARK: - History

struct HistoryView: View {
    @Environment(AppModel.self) private var model
    @State private var history: History?

    enum Item: Identifiable {
        case session(Session), workout(Workout)
        var id: String { switch self { case let .session(s): "s\(s.id)"; case let .workout(w): "w\(w.id)" } }
        var date: String { switch self { case let .session(s): s.date; case let .workout(w): w.date } }
    }

    var items: [Item] {
        guard let history else { return [] }
        let linked = Set(history.sessions.compactMap(\.workoutId))
        return (history.sessions.map(Item.session) + history.workouts.filter { !linked.contains($0.id) }.map(Item.workout))
            .sorted { $0.date > $1.date }
    }

    var body: some View {
        List {
            ForEach(items) { item in
                switch item {
                case let .session(s):
                    NavigationLink { SessionDetailView(session: s, workout: history?.workouts.first { $0.id == s.workoutId }) } label: {
                        HistoryRow(symbol: s.type == "run" ? "figure.run" : "figure.strengthtraining.traditional", title: s.dayKey == "R" ? "Run" : "Session \(s.dayKey)",
                                   subtitle: s.type == "run" ? "\(Fmt.number(s.distanceKm)) km · \(Fmt.duration(s.durationMin))" : "\(s.sets?.count ?? 0) sets\(s.workoutId != nil ? " · Watch" : "")",
                                   date: s.date)
                    }
                case let .workout(w):
                    NavigationLink { WorkoutDetailView(workout: w) } label: {
                        HistoryRow(symbol: "applewatch", title: w.type, subtitle: [Fmt.duration(w.durationMin), w.distanceKm.map { String(format: "%.2f km", $0) }].compactMap { $0 }.joined(separator: " · "), date: w.date)
                    }
                }
            }
        }
        .overlay { if history == nil { ProgressView() } }
        .navigationTitle("History")
        .task { history = try? await model.api?.history(limit: 60) }
        .refreshable { history = try? await model.api?.history(limit: 60) }
    }
}

struct HistoryRow: View {
    var symbol: String
    var title: String
    var subtitle: String
    var date: String
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).font(.title3).foregroundStyle(Color.accentColor).frame(width: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            Text(Fmt.day(date)).font(.subheadline).foregroundStyle(.secondary)
        }
    }
}

struct SessionDetailView: View {
    var session: Session
    var workout: Workout?

    var body: some View {
        List {
            if let workout { WorkoutSections(workout: workout) }
            let byExercise = Dictionary(grouping: session.sets ?? [], by: { $0.exerciseName ?? $0.exerciseId })
            ForEach(byExercise.keys.sorted(), id: \.self) { name in
                Section(name) {
                    ForEach(byExercise[name]!.sorted { $0.setIndex < $1.setIndex }, id: \.setIndex) { s in
                        LabeledContent("Set \(s.setIndex + 1)") { Text("\(Fmt.number(s.reps)) × \(Fmt.kg(s.weight))").numeric() }
                    }
                }
            }
            if let notes = session.notes { Section("Notes") { Text(notes) } }
        }
        .navigationTitle(Fmt.day(session.date))
    }
}

struct WorkoutDetailView: View {
    var workout: Workout
    var body: some View {
        List { WorkoutSections(workout: workout) }
            .navigationTitle(workout.type)
    }
}

/// Summary, heart-rate zones, running dynamics and splits for one Watch workout.
struct WorkoutSections: View {
    var workout: Workout

    var body: some View {
        Section("Apple Watch") {
            LabeledContent("Time", value: Fmt.duration(workout.durationMin))
            if let km = workout.distanceKm {
                LabeledContent("Distance", value: String(format: "%.2f km", km))
                if let pace = Fmt.pace(minutes: workout.durationMin, km: km) { LabeledContent("Pace", value: pace) }
            }
            if let kcal = workout.kcal { LabeledContent("Active energy", value: "\(Fmt.number(kcal)) kcal") }
            if let hr = workout.avgHr { LabeledContent("Heart rate", value: "\(hr) avg · \(workout.maxHr ?? hr) max") }
            if let r = workout.hrRecovery { LabeledContent("1-min recovery", value: "−\(r) bpm") }
            if let e = workout.effort { LabeledContent("Effort", value: String(format: "%.0f / 10", e)) }
            if let el = workout.elevationM, el > 0 { LabeledContent("Elevation gain", value: "\(Fmt.number(el)) m") }
        }
        if let zones = workout.analysis?.minutesPerZone, zones.reduce(0, +) > 0 {
            Section("Heart rate zones") {
                ZoneBar(minutes: zones).padding(.vertical, 6)
                ForEach(Array(zones.enumerated()), id: \.offset) { i, m in
                    LabeledContent {
                        Text("\(Fmt.number(m)) min").numeric()
                    } label: {
                        Label("Zone \(i + 1)", systemImage: "circle.fill").foregroundStyle(Palette.zones[i])
                    }
                }
            }
        }
        if let d = workout.details {
            let dynamics: [(String, String?)] = [
                ("Cadence", d.cadenceSpm.map { "\(Fmt.number($0)) spm" }), ("Power", d.powerW.map { "\(Fmt.number($0)) W" }),
                ("Stride length", d.strideM.map { String(format: "%.2f m", $0) }), ("Ground contact", d.groundContactMs.map { "\(Fmt.number($0)) ms" }),
                ("Vertical oscillation", d.verticalOscillationCm.map { String(format: "%.1f cm", $0) }),
            ]
            if dynamics.contains(where: { $0.1 != nil }) {
                Section("Running form") {
                    ForEach(dynamics.filter { $0.1 != nil }, id: \.0) { LabeledContent($0.0, value: $0.1!) }
                }
            }
            if let splits = d.splits, !splits.isEmpty {
                Section("Splits") {
                    ForEach(Array(splits.enumerated()), id: \.offset) { i, s in
                        LabeledContent(s.km < 1 ? String(format: "%.2f km", s.km) : "Km \(i + 1)") {
                            Text(Fmt.paceFrom(secPerKm: s.sec / s.km)).numeric()
                        }
                    }
                }
            }
        }
    }
}
