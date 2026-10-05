import SwiftUI
import RestbellKit

/// What is imported from Apple Health, when it last synced and which trigger ran it.
struct HealthStatusView: View {
    @Environment(AppModel.self) private var model
    @State private var reports = HealthSync.reports()
    @State private var syncing = false
    @State private var enabled = HealthSync.enabled
    @State private var groups = Dictionary(uniqueKeysWithValues: HealthSync.Group.allCases.map { ($0, HealthSync.isOn($0)) })
    @State private var writeWorkouts = HealthSync.writeWorkouts
    @State private var writeMeals = HealthSync.writeMeals

    var body: some View {
        List {
            if !HealthSync.isAvailable {
                ContentUnavailableView("Health isn't available", systemImage: "heart.slash", description: Text("Apple Health isn't available on this device."))
            } else if !enabled {
                Section {
                    Button("Connect Apple Health") {
                        Task {
                            try? await HealthSync.shared.requestAuthorization()
                            enabled = HealthSync.enabled
                            reports = HealthSync.reports()
                        }
                    }
                } footer: {
                    Text("Restbell reads workouts, heart rate, activity, sleep and weight. Nothing leaves your own server.")
                }
            } else {
                Section {
                    Button {
                        Task {
                            syncing = true
                            await HealthSync.shared.sync(trigger: .manual, days: 30)
                            reports = HealthSync.reports()
                            syncing = false
                            await model.refresh()
                        }
                    } label: {
                        HStack { Label("Sync Now", systemImage: "arrow.triangle.2.circlepath"); Spacer(); if syncing { ProgressView() } }
                    }
                    .disabled(syncing)
                } footer: {
                    Text("Re-sends the last 30 days. Normally this runs by itself: when a Watch workout is saved, every hour in the background, and every night.")
                }
                Section("Import") {
                    ForEach(HealthSync.Group.allCases) { g in
                        Toggle(isOn: Binding(get: { groups[g] ?? true }, set: { groups[g] = $0; HealthSync.set(g, $0) })) {
                            Label(g.title, systemImage: g.symbol)
                        }
                    }
                }
                Section {
                    Toggle("Save strength sessions as workouts", isOn: $writeWorkouts).onChange(of: writeWorkouts) { _, v in HealthSync.writeWorkouts = v }
                    Toggle("Save meals as nutrition", isOn: $writeMeals).onChange(of: writeMeals) { _, v in HealthSync.writeMeals = v }
                } header: {
                    Text("Write to Health")
                } footer: {
                    Text("A session is only saved when your Watch didn't already record a workout at that time.")
                }
                Section {
                    Link(destination: URL(string: "shortcuts://")!) { Label("Open Shortcuts", systemImage: "square.2.layers.3d") }
                } header: {
                    Text("Most reliable: a Shortcuts automation")
                } footer: {
                    Text("In Shortcuts → Automation, add \"Apple Watch Workout → Ends\" and a few \"Time of Day\" automations that run Restbell's \"Sync Apple Health\", set to run immediately.")
                }
            }
            if !reports.isEmpty {
                Section("Recent syncs") {
                    ForEach(reports) { r in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(r.trigger.label).font(.subheadline.weight(.medium))
                                Spacer()
                                Text(r.at.formatted(.relative(presentation: .named))).font(.caption).foregroundStyle(.secondary)
                            }
                            Text(r.summary).font(.caption).foregroundStyle(r.error == nil ? Color.secondary : Color.orange)
                        }
                    }
                }
            }
        }
        .navigationTitle("Apple Health")
    }
}

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var settings: Settings?
    @State private var reminderTime = Date()
    @State private var mode = Notifications.shared.mode
    @State private var channels: [String] = []

    struct Patch: Encodable {
        var targets: Targets?
        var reminders: Reminders?
        var debrief: Bool?
    }

    var body: some View {
        Form {
            if let s = settings {
                Section("Daily targets") {
                    Stepper(value: Binding(get: { s.targets.kcal }, set: { v in save(.init(targets: Targets(kcal: v, proteinG: s.targets.proteinG))) }), in: 1200...6000, step: 50) {
                        LabeledContent("Calories", value: "\(Fmt.number(s.targets.kcal)) kcal")
                    }
                    Stepper(value: Binding(get: { s.targets.proteinG }, set: { v in save(.init(targets: Targets(kcal: s.targets.kcal, proteinG: v))) }), in: 40...300, step: 5) {
                        LabeledContent("Protein", value: "\(Fmt.number(s.targets.proteinG)) g")
                    }
                }
                Section {
                    Toggle("Remind me if nothing is logged", isOn: Binding(get: { s.reminders.enabled }, set: { save(.init(reminders: Reminders(enabled: $0, time: s.reminders.time))) }))
                    if s.reminders.enabled {
                        DatePicker("At", selection: $reminderTime, displayedComponents: .hourAndMinute)
                            .onChange(of: reminderTime) { _, t in
                                let c = Calendar.current.dateComponents([.hour, .minute], from: t)
                                save(.init(reminders: Reminders(enabled: true, time: String(format: "%02d:%02d", c.hour ?? 20, c.minute ?? 30))))
                            }
                    }
                    Toggle("Coach debrief after each session", isOn: Binding(get: { s.debrief }, set: { save(.init(debrief: $0)) }))
                } header: {
                    Text("Reminders")
                }
                Section {
                    Picker("Delivered by", selection: $mode) {
                        ForEach(Notifications.Mode.allCases) { Text($0.title).tag($0) }
                    }
                    .onChange(of: mode) { _, m in
                        Notifications.shared.mode = m
                        if let summary = model.summary { Notifications.shared.reconcileLocalReminder(summary: summary) }
                    }
                } header: {
                    Text("Coach and reminder notifications")
                } footer: {
                    Text(channels.isEmpty
                         ? "The server has no push channel set up, so this iPhone posts them itself when iOS lets it run in the background. Set HA_NOTIFY_SERVICE or NTFY_URL on the server for instant delivery."
                         : "The server pushes through \(channels.joined(separator: " and ")). Rest-timer alerts always come from this iPhone.")
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Targets & Notifications")
        .task {
            guard let api = model.api else { return }
            settings = try? await api.settings()
            channels = (try? await api.health().notify) ?? []
            if channels.isEmpty, mode == .server { mode = .local; Notifications.shared.mode = .local }
            if let r = settings?.reminders {
                Notifications.shared.cachedReminders = r
                let parts = r.time.split(separator: ":").compactMap { Int($0) }
                if parts.count == 2, let d = Calendar.current.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: Date()) { reminderTime = d }
            }
        }
    }

    func save(_ patch: Patch) {
        Task {
            do {
                settings = try await model.api?.updateSettings(patch)
                if let r = settings?.reminders { Notifications.shared.cachedReminders = r }
                await model.refresh()
            } catch { model.flash(error.localizedDescription) }
        }
    }
}
