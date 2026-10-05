import Foundation

/// Guided session order, a port of public/guide.js so the app and the PWA agree on "what's next".
public enum GuideOrder: String, Sendable {
    /// Every set of an exercise, then the next exercise (gym lift days).
    case straight
    /// Set 1 of every exercise, then set 2, and so on (home circuits, travel sessions).
    case rounds

    public static func forDay(type: String) -> GuideOrder { type == "lift" ? .straight : .rounds }
}

public struct GuideStep: Hashable, Sendable {
    /// Index into the day's exercises.
    public var index: Int
    public var setIndex: Int
    public init(index: Int, setIndex: Int) { self.index = index; self.setIndex = setIndex }
}

public enum Guide {
    public static func isLogged(_ exerciseId: String, _ setIndex: Int, in sets: [LoggedSet]) -> Bool {
        sets.contains { $0.exerciseId == exerciseId && $0.setIndex == setIndex }
    }

    /// Distinct logged sets within the planned range.
    public static func loggedCount(_ ex: Exercise, in sets: [LoggedSet]) -> Int {
        Set(sets.filter { $0.exerciseId == ex.id && $0.setIndex < ex.sets }.map(\.setIndex)).count
    }

    public static func rounds(_ exercises: [Exercise]) -> Int { exercises.map(\.sets).max() ?? 0 }

    /// Unlogged sets in session order; the first one is the current step.
    public static func openSteps(_ exercises: [Exercise], logged sets: [LoggedSet], order: GuideOrder) -> [GuideStep] {
        var steps: [GuideStep] = []
        func add(_ index: Int, _ setIndex: Int) {
            let ex = exercises[index]
            if setIndex < ex.sets, !isLogged(ex.id, setIndex, in: sets) { steps.append(GuideStep(index: index, setIndex: setIndex)) }
        }
        switch order {
        case .straight:
            for (i, ex) in exercises.enumerated() { for k in 0..<max(ex.sets, 0) { add(i, k) } }
        case .rounds:
            for k in 0..<rounds(exercises) { for i in exercises.indices { add(i, k) } }
        }
        return steps
    }

    /// Starting values for a set: what was logged, else this session's previous set, the target, or last time.
    public static func prefill(_ ex: Exercise, setIndex: Int, session: [LoggedSet], lastTime: [LoggedSet]) -> (weight: Double, reps: Double) {
        let logged = session.first { $0.exerciseId == ex.id && $0.setIndex == setIndex }
        let prevInSession = session.last { $0.exerciseId == ex.id }
        let last = lastTime.first { $0.exerciseId == ex.id && $0.setIndex == setIndex }
        let weight = logged?.weight ?? prevInSession?.weight ?? ex.weight ?? last?.weight ?? 0
        let reps = logged?.reps ?? Double(ex.isTimed ? (ex.repMax ?? 30) : ex.targetReps)
        return (weight, reps)
    }
}
