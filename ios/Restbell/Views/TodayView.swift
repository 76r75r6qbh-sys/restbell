import SwiftUI
import RestbellKit
import UserNotifications
import UIKit

struct TodayView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("setup.healthDismissed") private var healthDismissed = false
    @State private var notificationsAllowed = true
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 16) {
                    if let s = model.summary {
                        if !HealthSync.enabled, !healthDismissed, HealthSync.isAvailable, !model.isDemo { connectHealthCard }
                        if !notificationsAllowed { notificationsCard }
                        if s.health.stale { staleCard(s.health) }
                        SessionCard(summary: s)
                        ringsCard(s)
                        if let r = s.recovery { RecoveryCard(recovery: r) }
                        HStack(spacing: 16) {
                            Card { StatTile(title: "This week", value: "\(s.week.done)/\(s.week.planned)", detail: s.week.remaining == 0 ? "All done" : "\(s.week.remaining) to go", symbol: "calendar", tint: .accentColor) }
                            Card { StatTile(title: "Streak", value: "\(s.streak)", detail: s.streak == 1 ? "week" : "weeks", symbol: "flame.fill", tint: .orange) }
                        }
                        if let w = s.lastWorkout { LastWorkoutCard(workout: w) }
                        if let bw = s.bodyweight { bodyweightCard(bw) }
                    } else if model.loading {
                        ProgressView().padding(.top, 80)
                    } else {
                        ContentUnavailableView("No data yet", systemImage: "wifi.exclamationmark", description: Text("Pull down to try the server again."))
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 24)
            }
            .groupedBackground()
            .refreshable {
                await model.refresh()
                await HealthSync.shared.sync(trigger: .manual)
            }
            .navigationTitle("Today")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Log Food", systemImage: "fork.knife") { model.showLogFood = true }
                        Button("Weigh In", systemImage: "scalemass") { model.showWeighIn = true }
                    } label: {
                        Label("Add", systemImage: "plus")
                    }
                }
            }
            .task { notificationsAllowed = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus != .denied }
        }
    }

    func ringsCard(_ s: Summary) -> some View {
        Card(title: "Fuel and activity", symbol: "chart.pie.fill", tint: .secondary) {
            let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16)) : AnyLayout(HStackLayout(alignment: .center, spacing: 16))
            layout {
                MacroRings(food: s.food)
                if s.activity.hasRings {
                    Spacer(minLength: 0)
                    RingStack(rings: s.activity.rings, lineWidth: 9)
                        .frame(width: 76)
                        .accessibilityLabel("Activity rings")
                        .accessibilityValue("Move \(Fmt.number(s.activity.moveKcal)) of \(Fmt.number(s.activity.moveGoal)) kilocalories, exercise \(Fmt.number(s.activity.exerciseMin)) of \(Fmt.number(s.activity.exerciseGoal)) minutes, stand \(Fmt.number(s.activity.standHours)) of \(Fmt.number(s.activity.standGoal)) hours")
                }
            }
            if let e = s.energy {
                Divider()
                HStack {
                    Label("Burned \(Fmt.number(e.outKcal)) kcal so far", systemImage: "bolt.heart")
                        .font(.footnote).foregroundStyle(.secondary)
                    Spacer()
                    Text(e.balance >= 0 ? "+\(Fmt.number(e.balance))" : Fmt.number(e.balance))
                        .font(.footnote.weight(.semibold)).numeric()
                        .foregroundStyle(e.balance >= 0 ? Color.green : Color.orange)
                        .accessibilityLabel("Energy balance \(Fmt.number(e.balance)) kilocalories")
                }
            }
        }
        .onTapGesture { model.tab = .food }
    }

    func bodyweightCard(_ bw: Summary.Bodyweight) -> some View {
        Card {
            HStack {
                StatTile(title: "Bodyweight", value: Fmt.kg(bw.kg), detail: bw.delta.map { "\($0 > 0 ? "+" : "")\(String(format: "%.1f", $0)) kg over \(bw.over) weigh-ins" }, symbol: "scalemass.fill", tint: .teal)
                Button("Weigh In") { model.showWeighIn = true }.buttonStyle(.bordered)
            }
        }
    }

    var connectHealthCard: some View {
        Card(title: "Apple Health", symbol: "heart.fill", tint: .pink) {
            Text("Import Watch workouts, sleep, HRV and activity automatically so the coach sees your recovery.")
                .font(.callout).foregroundStyle(.secondary)
            HStack {
                Button("Connect") {
                    Task {
                        try? await HealthSync.shared.requestAuthorization()
                        await model.refresh()
                    }
                }
                .prominentButton()
                Button("Not Now") { healthDismissed = true }.buttonStyle(.bordered)
            }
        }
    }

    var notificationsCard: some View {
        Card(title: "Notifications are off", symbol: "bell.slash.fill", tint: .orange) {
            Text("Turn them on in Settings to hear when rest is over and when your coach replies.")
                .font(.callout).foregroundStyle(.secondary)
            Button("Open Settings") { UIApplication.shared.open(URL(string: UIApplication.openNotificationSettingsURLString)!) }
                .buttonStyle(.bordered)
        }
    }

    func staleCard(_ h: Summary.Health) -> some View {
        Card(title: "Health sync paused", symbol: "exclamationmark.arrow.triangle.2.circlepath", tint: .orange) {
            Text("Nothing from Apple Health since \(ISOTime.parse(h.lastSync)?.formatted(.relative(presentation: .named)) ?? "a while"). Open More → Apple Health to check, or add the Shortcuts automation.")
                .font(.callout).foregroundStyle(.secondary)
        }
    }
}

/// Today's session with the one action that matters.
struct SessionCard: View {
    @Environment(AppModel.self) private var model
    var summary: Summary
    @State private var starting = false

    var info: Summary.SessionInfo { summary.session }

    var body: some View {
        Card {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: symbol)
                    .font(.title2)
                    .foregroundStyle(.white)
                    .frame(width: 52, height: 52)
                    .background(Color.accentColor.gradient, in: .rect(cornerRadius: 14, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(statusLabel).font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
                    Text(info.title ?? "Rest day").font(.title3.weight(.semibold))
                    if let detail { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
                }
                Spacer(minLength: 0)
            }
            if info.status == "active", let total = info.setsTotal, total > 0 {
                ProgressView(value: Double(info.setsDone ?? 0), total: Double(total)).tint(.accentColor)
            }
            if summary.recovery?.level == "low", info.status == "planned" {
                Label("Recovery is low today: keep 2–3 reps in reserve.", systemImage: "heart.text.square")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if info.status == "planned" || info.status == "active" {
                Button {
                    Task { await open() }
                } label: {
                    Label(info.status == "active" ? "Resume" : "Start", systemImage: "play.fill")
                        .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                .prominentButton()
                .disabled(starting)
            }
        }
    }

    var symbol: String {
        switch info.type {
        case "run": "figure.run"
        case "home", "travel": "figure.core.training"
        case "lift": "figure.strengthtraining.traditional"
        default: "moon.zzz.fill"
        }
    }

    var statusLabel: String {
        switch info.status {
        case "active": "In progress"
        case "done": "Done today"
        case "planned": info.time.map { "Planned · \($0)" } ?? "Planned"
        default: "Today"
        }
    }

    var detail: String? {
        switch info.status {
        case "active": "\(info.setsDone ?? 0) of \(info.setsTotal ?? 0) sets"
        case "done": "Nice work."
        case "rest": "Recover, walk, eat well."
        default: info.setsTotal.map { "\($0) sets" }
        }
    }

    func open() async {
        starting = true
        defer { starting = false }
        if info.status == "planned", let today = model.today {
            do { try await model.workout.start(today: today) } catch { model.flash(error.localizedDescription); return }
        }
        model.showSession = true
    }
}

struct RecoveryCard: View {
    var recovery: Summary.Recovery

    var body: some View {
        Card(title: "Recovery", symbol: "heart.text.square.fill", tint: Palette.recovery(recovery.level)) {
            HStack(alignment: .center, spacing: 16) {
                Gauge(value: Double(recovery.score), in: 0...100) {
                    EmptyView()
                } currentValueLabel: {
                    Text("\(recovery.score)").numeric()
                }
                .gaugeStyle(.accessoryCircularCapacity)
                .tint(Palette.recovery(recovery.level))
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.headline)
                    Text(recovery.reasons.isEmpty ? "In line with your usual sleep, HRV and resting heart rate." : recovery.reasons.joined(separator: " · "))
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    var title: String {
        switch recovery.level {
        case "good": "Ready to train"
        case "ok": "Train, but listen to your body"
        default: "Take it easier today"
        }
    }
}

struct LastWorkoutCard: View {
    var workout: Summary.LastWorkout

    var body: some View {
        Card(title: "Apple Watch", symbol: "applewatch", tint: .secondary) {
            HStack(alignment: .firstTextBaseline) {
                Text(workout.type).font(.headline)
                Spacer()
                Text(Fmt.day(workout.date)).font(.subheadline).foregroundStyle(.secondary)
            }
            HStack(spacing: 18) {
                metric(Fmt.duration(workout.durationMin), "Time")
                if let km = workout.distanceKm { metric(String(format: "%.2f km", km), "Distance") }
                if let hr = workout.avgHr { metric("\(hr)", "Avg BPM") }
                if let e = workout.effort { metric(String(format: "%.0f", e), "Effort") }
            }
            if let zones = workout.minutesPerZone, zones.reduce(0, +) > 0 { ZoneBar(minutes: zones) }
        }
    }

    func metric(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title3.weight(.semibold)).numeric()
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}
