import Foundation
#if canImport(ActivityKit)
import ActivityKit

/// The Live Activity for a running session (Lock Screen and Dynamic Island).
/// The app updates it locally on every set; no push is needed, so it works with a free developer account.
struct WorkoutAttributes: ActivityAttributes {
    enum Phase: String, Codable, Hashable {
        case lifting, resting, running, done
    }

    struct ContentState: Codable, Hashable {
        var exerciseName: String
        /// "Set 2 of 3"
        var setLabel: String
        /// "8 × 60 kg"
        var target: String
        var phase: Phase
        var restEndsAt: Date?
        var restStartedAt: Date?
        var setsDone: Int
        var setsTotal: Int
        /// What comes after the current set, for the expanded views.
        var next: String?

        var progress: Double { setsTotal > 0 ? Double(setsDone) / Double(setsTotal) : 0 }
        var restRange: ClosedRange<Date>? {
            guard phase == .resting, let start = restStartedAt, let end = restEndsAt, end > start else { return nil }
            return start...end
        }
    }

    var title: String
    var dayType: String
    var startedAt: Date
}
#endif
