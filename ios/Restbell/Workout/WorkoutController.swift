import SwiftUI
import ActivityKit
import RestbellKit
import UIKit

/// Runs a session: current step, logging (queued when offline), the rest timer with its notification,
/// and the Live Activity on the Lock Screen and in the Dynamic Island.
@Observable @MainActor
final class WorkoutController {
    @ObservationIgnored weak var app: AppModel?

    var day: Day?
    var session: Session?
    var sets: [LoggedSet] = []
    var lastTime: [LoggedSet] = []
    var restEndsAt: Date?
    var restStartedAt: Date?
    var lastLogged: String?
    var busy = false
    var finished: FinishResult?
    /// Set count that's logged on the phone but not yet on the server.
    var queued = 0

    @ObservationIgnored private var activity: Activity<WorkoutAttributes>?
    @ObservationIgnored private var restTask: Task<Void, Never>?
    @ObservationIgnored let queue = SetQueue(directory: AppGroup.containerURL)

    var exercises: [Exercise] { day?.exercises ?? [] }
    var order: GuideOrder { GuideOrder.forDay(type: day?.type ?? "lift") }
    var openSteps: [GuideStep] { Guide.openSteps(exercises, logged: sets, order: order) }
    var current: GuideStep? { openSteps.first }
    var currentExercise: Exercise? { current.map { exercises[$0.index] } }
    var setsTotal: Int { exercises.reduce(0) { $0 + $1.sets } }
    var setsDone: Int { exercises.reduce(0) { $0 + Guide.loggedCount($1, in: sets) } }
    var isResting: Bool { (restEndsAt ?? .distantPast) > Date() }
    var isRun: Bool { day?.type == "run" }
    var isActive: Bool { session != nil && finished == nil }

    // MARK: Lifecycle

    /// Pick up a session that is already open on the server (started on the PWA, or before the app was killed).
    func restoreIfNeeded(today: Today) async {
        guard session == nil, let open = today.openSession else { return }
        day = today.day
        session = open
        sets = open.sets ?? []
        lastTime = today.lastSession?.sets ?? []
        queued = await queue.count
        startActivity()
    }

    func start(today: Today) async throws {
        guard let api = app?.api, let day = today.day else { return }
        busy = true
        defer { busy = false }
        let s = try await api.startSession(date: today.date, dayKey: day.key)
        self.day = day
        session = s
        sets = s.sets ?? []
        lastTime = today.lastSession?.sets ?? []
        finished = nil
        startActivity()
        // Ask for notifications (rest alerts) without blocking the session on the answer; demo mode never asks.
        if !SharedStore.demo { Task { _ = await Notifications.shared.requestPermission() } }
    }

    // MARK: Logging

    func prefill(for step: GuideStep) -> (weight: Double, reps: Double) {
        Guide.prefill(exercises[step.index], setIndex: step.setIndex, session: sets, lastTime: lastTime)
    }

    func log(weight: Double, reps: Double) async {
        guard let session, let step = current, let api = app?.api else { return }
        let ex = exercises[step.index]
        let set = LoggedSet(exerciseId: ex.id, exerciseName: ex.name, setIndex: step.setIndex, targetReps: ex.targetReps, reps: reps, weight: weight)
        sets.removeAll { $0.exerciseId == ex.id && $0.setIndex == step.setIndex }
        sets.append(set)
        lastLogged = "\(ex.name) · set \(step.setIndex + 1) logged"
        do {
            _ = try await api.logSet(sessionId: session.id, set)
        } catch let e as APIError where e.isOffline {
            await queue.enqueue(sessionId: session.id, set)
            queued = await queue.count
        } catch {
            app?.flash(error.localizedDescription)
        }
        if current == nil {
            stopRest()
        } else {
            startRest(seconds: ex.restSec ?? 90)
        }
        updateActivity()
    }

    func remove(_ set: LoggedSet) async {
        guard let session, let api = app?.api else { return }
        sets.removeAll { $0.exerciseId == set.exerciseId && $0.setIndex == set.setIndex }
        _ = try? await api.deleteSet(sessionId: session.id, exerciseId: set.exerciseId, setIndex: set.setIndex)
        updateActivity()
    }

    // MARK: Rest

    func startRest(seconds: Int) {
        let now = Date()
        restStartedAt = now
        restEndsAt = now.addingTimeInterval(TimeInterval(seconds))
        Notifications.shared.scheduleRestEnd(at: restEndsAt!, next: nextDescription)
        restTask?.cancel()
        restTask = Task { [weak self] in
            try? await Task.sleep(until: .now + .seconds(seconds), clock: .continuous)
            guard !Task.isCancelled else { return }
            self?.restEnded()
        }
    }

    func addRest(_ seconds: TimeInterval = 30) {
        guard let end = restEndsAt, end > Date() else { return startRest(seconds: Int(seconds)) }
        let remaining = end.timeIntervalSinceNow + seconds
        let started = restStartedAt
        startRest(seconds: Int(remaining.rounded()))
        restStartedAt = started
        updateActivity()
    }

    func stopRest() {
        restTask?.cancel()
        restEndsAt = nil
        restStartedAt = nil
        Notifications.shared.cancelRestEnd()
        updateActivity()
    }

    private func restEnded() {
        restEndsAt = nil
        restStartedAt = nil
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        updateActivity()
    }

    var nextDescription: String {
        guard let step = current else { return "All sets done. Finish the session." }
        let ex = exercises[step.index]
        return "\(ex.name), set \(step.setIndex + 1) of \(ex.sets) · \(Fmt.target(ex, weight: prefill(for: step).weight))"
    }

    // MARK: Finish

    func finish(feel: Int?, notes: String?, distanceKm: Double? = nil, durationMin: Double? = nil) async {
        guard let session, let api = app?.api else { return }
        busy = true
        defer { busy = false }
        await queue.flush(using: api)
        queued = await queue.count
        do {
            let result = try await api.finishSession(id: session.id, .init(feel: feel, notes: notes, distanceKm: distanceKm, durationMin: durationMin))
            finished = result
            stopRest()
            await endActivity()
            if let start = ISOTime.parse(session.startedAt), !isRun {
                await HealthSync.shared.saveStrengthWorkout(start: start, end: Date())
            }
            await app?.refresh()
        } catch {
            app?.flash(error.localizedDescription)
        }
    }

    /// Throw the session away (started by mistake).
    func discard() async {
        if let session, let api = app?.api { _ = try? await api.deleteSession(id: session.id) }
        stopRest()
        await endActivity()
        reset()
        await app?.refresh()
    }

    func reset() {
        day = nil
        session = nil
        sets = []
        finished = nil
        lastLogged = nil
    }

    // MARK: Live Activity buttons

    func perform(_ action: WorkoutAction) async {
        if session == nil, let api = app?.api, let today = try? await api.today() { await restoreIfNeeded(today: today) }
        switch action {
        case .logPrescribed:
            guard let step = current else { return }
            let p = prefill(for: step)
            await log(weight: p.weight, reps: p.reps)
        case .addRest: addRest(30)
        case .skipRest: stopRest()
        }
    }

    // MARK: Live Activity

    private var contentState: WorkoutAttributes.ContentState {
        let phase: WorkoutAttributes.Phase = isRun ? .running : current == nil ? .done : isResting ? .resting : .lifting
        if let step = current {
            let ex = exercises[step.index]
            let p = prefill(for: step)
            let after = openSteps.dropFirst().first.map { s in "Then \(exercises[s.index].name), set \(s.setIndex + 1)" }
            return .init(exerciseName: ex.name, setLabel: "Set \(step.setIndex + 1) of \(ex.sets)", target: Fmt.target(ex, weight: p.weight),
                         phase: phase, restEndsAt: isResting ? restEndsAt : nil, restStartedAt: isResting ? restStartedAt : nil,
                         setsDone: setsDone, setsTotal: setsTotal, next: after)
        }
        return .init(exerciseName: isRun ? (day?.title ?? "Run") : "All sets done", setLabel: isRun ? "Running" : "Finish in the app",
                     target: "", phase: phase, restEndsAt: nil, restStartedAt: nil, setsDone: setsDone, setsTotal: setsTotal, next: nil)
    }

    private func startActivity() {
        guard activity == nil, ActivityAuthorizationInfo().areActivitiesEnabled, let day, let session else { return }
        // Reuse an activity that survived an app restart.
        if let existing = Activity<WorkoutAttributes>.activities.first {
            activity = existing
            updateActivity()
            return
        }
        let attributes = WorkoutAttributes(title: day.title, dayType: day.type, startedAt: ISOTime.parse(session.startedAt) ?? Date())
        activity = try? Activity.request(attributes: attributes, content: .init(state: contentState, staleDate: nil), pushType: nil)
    }

    private func updateActivity() {
        guard let activity else { return }
        let state = contentState
        // Stale an hour after the last change, so a forgotten session doesn't sit on the Lock Screen all day.
        Task { await activity.update(.init(state: state, staleDate: Date().addingTimeInterval(3600)), alertConfiguration: nil) }
    }

    private func endActivity() async {
        for a in Activity<WorkoutAttributes>.activities {
            await a.end(.init(state: contentState, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(15 * 60)))
        }
        activity = nil
    }
}
