import SwiftUI
import RestbellKit

/// Full-screen session: one set at a time, rest timer, then the finish form.
struct SessionView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var workout: WorkoutController { model.workout }

    var body: some View {
        NavigationStack {
            Group {
                if let result = workout.finished {
                    FinishedView(result: result) {
                        workout.reset()
                        dismiss()
                    }
                } else if workout.isRun {
                    RunView()
                } else if workout.current == nil, workout.session != nil {
                    FinishForm()
                } else if workout.session != nil {
                    GuidedSetView()
                } else {
                    ContentUnavailableView("No session", systemImage: "figure.strengthtraining.traditional", description: Text("Start today's session from Today."))
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "chevron.down") { dismiss() }
                        .labelStyle(.iconOnly)
                }
                if workout.isActive {
                    ToolbarItem(placement: .principal) {
                        VStack(spacing: 2) {
                            Text(workout.day?.title ?? "").font(.headline).lineLimit(1)
                            if !workout.isRun {
                                Text("\(workout.setsDone) of \(workout.setsTotal) sets").font(.caption).foregroundStyle(.secondary).numeric()
                            }
                        }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Menu {
                            if !workout.isRun, workout.current != nil {
                                NavigationLink { SetListView() } label: { Label("All Sets", systemImage: "list.bullet") }
                            }
                            Button("Discard Session", systemImage: "trash", role: .destructive) {
                                Task {
                                    await workout.discard()
                                    dismiss()
                                }
                            }
                        } label: {
                            Label("More", systemImage: "ellipsis")
                        }
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct GuidedSetView: View {
    @Environment(AppModel.self) private var model
    @State private var weight: Double = 0
    @State private var reps: Double = 0
    @State private var loggedCount = 0

    var workout: WorkoutController { model.workout }

    var body: some View {
        VStack(spacing: 0) {
            if workout.isResting {
                RestView()
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
            } else if let step = workout.current {
                setView(step)
                    .transition(.opacity)
            }
        }
        .animation(.spring(duration: 0.4), value: workout.isResting)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .groupedBackground()
        .onAppear { prefill() }
        .onChange(of: workout.current) { prefill() }
        .sensoryFeedback(.success, trigger: loggedCount)
    }

    func prefill() {
        guard let step = workout.current else { return }
        let p = workout.prefill(for: step)
        weight = p.weight
        reps = p.reps
    }

    @ViewBuilder
    func setView(_ step: GuideStep) -> some View {
        let ex = workout.exercises[step.index]
        ScrollView {
            VStack(spacing: 24) {
                ProgressView(value: Double(workout.setsDone), total: Double(max(workout.setsTotal, 1)))
                    .tint(.accentColor)
                    .padding(.horizontal)
                if model.summary?.recovery?.level == "low" {
                    Label("Low recovery today: leave 2–3 reps in reserve.", systemImage: "heart.text.square")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                VStack(spacing: 6) {
                    Text("Set \(step.setIndex + 1) of \(ex.sets)")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Color.accentColor).textCase(.uppercase)
                    Text(ex.name).font(.largeTitle.bold()).multilineTextAlignment(.center)
                    Text("Target \(Fmt.target(ex))").font(.title3).foregroundStyle(.secondary).numeric()
                    if let cue = ex.cue {
                        Text(cue).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.top, 4)
                    }
                    if let last = workout.lastTime.first(where: { $0.exerciseId == ex.id && $0.setIndex == step.setIndex }) {
                        Text("Last time: \(Fmt.number(last.reps))\(ex.isTimed ? " s" : " reps") at \(Fmt.kg(last.weight))")
                            .font(.footnote).foregroundStyle(.secondary).numeric()
                    }
                }
                .padding(.horizontal)
                Card {
                    VStack(spacing: 20) {
                        if (ex.weight ?? 0) > 0 || (ex.increment ?? 0) > 0 || weight > 0 {
                            ValueStepper(title: "Weight", value: $weight, step: ex.increment ?? 2.5, unit: "kg")
                        }
                        ValueStepper(title: ex.isTimed ? "Seconds" : "Reps", value: $reps, step: ex.isTimed ? 5 : 1, unit: ex.isTimed ? "seconds" : "reps")
                    }
                    .frame(maxWidth: .infinity)
                }
                .padding(.horizontal)
                if let last = workout.lastLogged {
                    Label(last, systemImage: "checkmark.circle.fill").font(.footnote).foregroundStyle(.secondary)
                }
                if workout.queued > 0 {
                    Label("\(workout.queued) set\(workout.queued == 1 ? "" : "s") saved on the phone, will sync", systemImage: "icloud.slash")
                        .font(.footnote).foregroundStyle(.orange)
                }
            }
            .padding(.vertical)
        }
        .safeAreaInset(edge: .bottom) {
            Button {
                loggedCount += 1
                Task { await workout.log(weight: weight, reps: reps) }
            } label: {
                Label("Log Set", systemImage: "checkmark")
                    .font(.title3.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
            }
            .prominentButton()
            .controlSize(.large)
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
    }
}

struct RestView: View {
    @Environment(AppModel.self) private var model
    var workout: WorkoutController { model.workout }

    var body: some View {
        VStack(spacing: 28) {
            Spacer()
            Text("Rest").font(.title2.weight(.semibold)).foregroundStyle(.secondary)
            if let start = workout.restStartedAt, let end = workout.restEndsAt {
                ZStack {
                    TimelineView(.animation(minimumInterval: 0.25)) { context in
                        let total = end.timeIntervalSince(start)
                        let left = max(0, end.timeIntervalSince(context.date))
                        ProgressRing(progress: total > 0 ? left / total : 0, color: .accentColor, lineWidth: 16)
                    }
                    Text(timerInterval: start...end, countsDown: true)
                        .font(.system(size: 72, weight: .semibold, design: .rounded)).monospacedDigit()
                        .multilineTextAlignment(.center)
                }
                .frame(width: 280, height: 280)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Rest timer")
            }
            VStack(spacing: 4) {
                Text("Next").font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
                Text(workout.nextDescription).font(.headline).multilineTextAlignment(.center)
            }
            .padding(.horizontal)
            Spacer()
            HStack(spacing: 12) {
                Button { workout.addRest(30) } label: { Label("30 s", systemImage: "plus").frame(maxWidth: .infinity).padding(.vertical, 8) }
                    .buttonStyle(.bordered)
                Button { workout.stopRest() } label: { Label("Skip", systemImage: "forward.fill").frame(maxWidth: .infinity).padding(.vertical, 8) }
                    .prominentButton()
            }
            .controlSize(.large)
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
    }
}

/// Every set of the session, to fix or remove one out of order.
struct SetListView: View {
    @Environment(AppModel.self) private var model
    var workout: WorkoutController { model.workout }

    var body: some View {
        List {
            ForEach(workout.exercises) { ex in
                Section(ex.name) {
                    ForEach(0..<ex.sets, id: \.self) { i in
                        let logged = workout.sets.first { $0.exerciseId == ex.id && $0.setIndex == i }
                        HStack {
                            Text("Set \(i + 1)")
                            Spacer()
                            if let logged {
                                Text("\(Fmt.number(logged.reps))\(ex.isTimed ? " s" : "") × \(Fmt.kg(logged.weight))").numeric()
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                            } else {
                                Text(Fmt.target(ex)).foregroundStyle(.secondary).numeric()
                            }
                        }
                        .swipeActions {
                            if let logged {
                                Button("Remove", role: .destructive) { Task { await workout.remove(logged) } }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("All Sets")
    }
}

struct FinishForm: View {
    @Environment(AppModel.self) private var model
    @State private var feel = 3
    @State private var notes = ""

    var body: some View {
        Form {
            Section {
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.seal.fill").font(.system(size: 56)).foregroundStyle(.green).symbolEffect(.bounce, value: true)
                    Text("All sets done").font(.title2.bold())
                    Text("\(model.workout.setsDone) sets logged").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
            }
            Section("How did it feel?") {
                Picker("Feel", selection: $feel) {
                    Text("😩").tag(1); Text("😕").tag(2); Text("🙂").tag(3); Text("💪").tag(4); Text("🔥").tag(5)
                }
                .pickerStyle(.segmented)
                TextField("Notes for the coach (optional)", text: $notes, axis: .vertical).lineLimit(2...4)
            }
            Section {
                Button {
                    Task { await model.workout.finish(feel: feel, notes: notes.isEmpty ? nil : notes) }
                } label: {
                    HStack { Spacer(); if model.workout.busy { ProgressView() } else { Text("Finish Session").bold() }; Spacer() }
                }
                .disabled(model.workout.busy)
            }
        }
    }
}

struct RunView: View {
    @Environment(AppModel.self) private var model
    @State private var km: Double = 0
    @State private var minutes: Double = 0
    @State private var feel = 3
    @State private var notes = ""

    var body: some View {
        Form {
            if let started = model.workout.session.flatMap({ ISOTime.parse($0.startedAt) }) {
                Section {
                    VStack(spacing: 4) {
                        Text("Elapsed").font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
                        Text(started, style: .timer).font(.system(size: 64, weight: .semibold, design: .rounded)).monospacedDigit()
                        if let target = model.workout.day?.targetDistanceKm { Text("Target \(Fmt.number(target)) km easy").foregroundStyle(.secondary) }
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }
            }
            Section {
                LabeledContent("Distance") { TextField("km", value: $km, format: .number).keyboardType(.decimalPad).multilineTextAlignment(.trailing) }
                LabeledContent("Time") { TextField("min", value: $minutes, format: .number).keyboardType(.decimalPad).multilineTextAlignment(.trailing) }
            } header: {
                Text("When you're back")
            } footer: {
                Text("Run with your Watch: its workout fills these in from Apple Health.")
            }
            Section("How did it feel?") {
                Picker("Feel", selection: $feel) {
                    Text("😩").tag(1); Text("😕").tag(2); Text("🙂").tag(3); Text("💪").tag(4); Text("🔥").tag(5)
                }
                .pickerStyle(.segmented)
                TextField("Notes (optional)", text: $notes, axis: .vertical)
            }
            Section {
                Button("Finish Run") {
                    Task { await model.workout.finish(feel: feel, notes: notes.isEmpty ? nil : notes, distanceKm: km > 0 ? km : nil, durationMin: minutes > 0 ? minutes : nil) }
                }
                .frame(maxWidth: .infinity)
                .disabled(model.workout.busy)
            }
        }
        .task {
            // Prefill from a Watch run imported since the session started.
            await HealthSync.shared.sync(trigger: .manual)
            if let w = try? await model.api?.history(limit: 3).workouts.first(where: { $0.type == "Running" && $0.date == DayString.today() }) {
                km = w.distanceKm ?? 0
                minutes = w.durationMin ?? 0
            }
        }
    }
}

struct FinishedView: View {
    var result: FinishResult
    var done: () -> Void

    var body: some View {
        List {
            Section {
                VStack(spacing: 8) {
                    Image(systemName: "trophy.fill").font(.system(size: 56)).foregroundStyle(.yellow).symbolEffect(.bounce, value: true)
                    Text("Session saved").font(.title2.bold())
                    Text("Your coach will send a short debrief.").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
            }
            let raised = result.changes.filter { $0.weight != $0.from }
            if !raised.isEmpty {
                Section("Next time") {
                    ForEach(raised, id: \.exerciseId) { c in
                        LabeledContent(c.name) {
                            Text("\(Fmt.kg(c.from)) → \(Fmt.kg(c.weight))").numeric().foregroundStyle((c.weight ?? 0) > (c.from ?? 0) ? Color.green : Color.orange)
                        }
                    }
                }
            }
            Section { Button("Done", action: done).frame(maxWidth: .infinity).bold() }
        }
        .sensoryFeedback(.success, trigger: true)
    }
}
