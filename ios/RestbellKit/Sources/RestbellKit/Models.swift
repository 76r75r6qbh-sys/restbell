import Foundation

// Codable mirrors of the server's JSON (src/api.js). Dates stay as the server's strings:
// days are "YYYY-MM-DD", timestamps are ISO 8601. Numbers the server may send as null are optional.

public struct Targets: Codable, Hashable, Sendable {
    public var kcal: Double
    public var proteinG: Double
    public init(kcal: Double, proteinG: Double) { self.kcal = kcal; self.proteinG = proteinG }
}

// MARK: - Summary (widgets and Today)

public struct Summary: Codable, Hashable, Sendable {
    public struct Food: Codable, Hashable, Sendable {
        public var kcal: Double
        public var proteinG: Double
        public var entries: Int
        public var targets: Targets
        public init(kcal: Double, proteinG: Double, entries: Int, targets: Targets) {
            self.kcal = kcal; self.proteinG = proteinG; self.entries = entries; self.targets = targets
        }
    }
    public struct SessionInfo: Codable, Hashable, Sendable {
        /// rest, planned, active or done
        public var status: String
        public var dayKey: String?
        public var title: String?
        public var type: String?
        public var time: String?
        public var sessionId: Int?
        public var setsDone: Int?
        public var setsTotal: Int?
    }
    public struct Week: Codable, Hashable, Sendable {
        public var start: String
        public var done: Int
        public var planned: Int
        public var remaining: Int
        public var holiday: Bool
    }
    public struct Bodyweight: Codable, Hashable, Sendable {
        public var kg: Double
        public var date: String
        public var delta: Double?
        public var over: Int
    }
    public struct LastWorkout: Codable, Hashable, Sendable {
        public var id: Int
        public var date: String
        public var type: String
        public var durationMin: Double?
        public var distanceKm: Double?
        public var kcal: Double?
        public var avgHr: Int?
        public var intensity: String?
        public var minutesPerZone: [Double]?
        public var effort: Double?
    }
    public struct Activity: Codable, Hashable, Sendable {
        public var moveKcal: Double?
        public var moveGoal: Double?
        public var exerciseMin: Double?
        public var exerciseGoal: Double?
        public var standHours: Double?
        public var standGoal: Double?
        public var steps: Double?
        public var sleepMin: Double?
    }
    public struct Energy: Codable, Hashable, Sendable {
        public var date: String
        public var outKcal: Double
        public var inKcal: Double
        public var balance: Double
    }
    public struct Recovery: Codable, Hashable, Sendable {
        /// good, ok or low
        public var level: String
        public var score: Int
        public var reasons: [String]
    }
    public struct Health: Codable, Hashable, Sendable {
        public var lastSync: String?
        public var stale: Bool
    }
    public struct FavoriteRef: Codable, Hashable, Sendable, Identifiable {
        public var id: Int
        public var name: String
        public var kcal: Double
        public var proteinG: Double
        public init(id: Int, name: String, kcal: Double, proteinG: Double) {
            self.id = id; self.name = name; self.kcal = kcal; self.proteinG = proteinG
        }
    }

    public var date: String
    public var food: Food
    public var session: SessionInfo
    public var week: Week
    public var streak: Int
    public var bodyweight: Bodyweight?
    public var unreadChat: Int
    public var lastWorkout: LastWorkout?
    public var activity: Activity
    public var energy: Energy?
    public var recovery: Recovery?
    public var health: Health
    public var favorites: [FavoriteRef]
}

// MARK: - Program and sessions

public struct Exercise: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var sets: Int
    public var repMin: Int?
    public var repMax: Int?
    public var weight: Double?
    public var increment: Double?
    public var restSec: Int?
    public var cue: String?
    /// "sec" for timed holds; reps otherwise.
    public var unit: String?

    public var isTimed: Bool { unit == "sec" }
    public var targetReps: Int { repMax ?? repMin ?? 8 }
}

public struct Day: Codable, Hashable, Sendable {
    public var key: String
    public var weekday: Int?
    public var time: String?
    public var type: String
    public var title: String
    public var targetDistanceKm: Double?
    public var cue: String?
    public var exercises: [Exercise]
}

public struct DayRef: Codable, Hashable, Sendable {
    public var key: String
    public var weekday: Int?
    public var title: String
    public var type: String
    public var time: String?
}

public struct LoggedSet: Codable, Hashable, Sendable {
    public var id: Int?
    public var sessionId: Int?
    public var exerciseId: String
    public var exerciseName: String?
    public var setIndex: Int
    public var targetReps: Int?
    public var reps: Double
    public var weight: Double
    public var doneAt: String?

    public init(exerciseId: String, exerciseName: String?, setIndex: Int, targetReps: Int?, reps: Double, weight: Double) {
        self.exerciseId = exerciseId
        self.exerciseName = exerciseName
        self.setIndex = setIndex
        self.targetReps = targetReps
        self.reps = reps
        self.weight = weight
    }
}

public struct Session: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var date: String
    public var dayKey: String
    public var type: String
    public var startedAt: String
    public var finishedAt: String?
    public var feel: Int?
    public var notes: String?
    public var distanceKm: Double?
    public var durationMin: Double?
    public var workoutId: Int?
    public var sets: [LoggedSet]?
}

public struct LastSession: Codable, Hashable, Sendable {
    public var date: String
    public var feel: Int?
    public var notes: String?
    public var sets: [LoggedSet]
}

public struct Today: Codable, Hashable, Sendable {
    public var date: String
    public var programName: String
    public var programNotes: String?
    public var day: Day?
    public var openSession: Session?
    public var lastSession: LastSession?
    public var days: [DayRef]
}

public struct ProgressionChange: Codable, Hashable, Sendable {
    public var exerciseId: String
    public var name: String
    public var change: String?
    public var from: Double?
    public var weight: Double?
}

public struct FinishResult: Codable, Hashable, Sendable {
    public var session: Session
    public var changes: [ProgressionChange]
}

// MARK: - Food

public struct FoodEntry: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var date: String
    public var text: String
    public var kcal: Double
    public var proteinG: Double
    public var createdAt: String?
}

public struct FoodDay: Codable, Hashable, Sendable {
    public struct Totals: Codable, Hashable, Sendable { public var kcal: Double; public var proteinG: Double }
    public var date: String
    public var entries: [FoodEntry]
    public var totals: Totals
    public var targets: Targets
    public var estimator: Bool
}

public struct Favorite: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var name: String
    public var text: String
    public var kcal: Double
    public var proteinG: Double
}

public struct RecentMeal: Codable, Hashable, Sendable {
    public var text: String
    public var kcal: Double
    public var proteinG: Double
    public var date: String
}

public struct QuickFoods: Codable, Hashable, Sendable {
    public var favorites: [Favorite]
    public var recent: [RecentMeal]
}

public struct FoodEstimate: Codable, Hashable, Sendable {
    public struct Item: Codable, Hashable, Sendable { public var name: String; public var kcal: Double; public var proteinG: Double }
    public var items: [Item]
    public var kcal: Double
    public var proteinG: Double
    public var note: String
}

// MARK: - Coach

public struct ChatMessage: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    /// user or coach
    public var role: String
    /// chat, review, debrief or error
    public var kind: String
    public var text: String
    public var createdAt: String
    public var readAt: String?

    public var isMine: Bool { role == "user" }
}

public struct ChatPage: Codable, Hashable, Sendable {
    public var messages: [ChatMessage]
    public var pending: Bool
    public var unread: Int
    public var enabled: Bool
}

public struct ChatSent: Codable, Hashable, Sendable {
    public var message: ChatMessage
    public var pending: Bool
}

public struct CoachNote: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var weekStart: String
    public var text: String
    public var createdAt: String
}

public struct Proposal: Codable, Hashable, Sendable, Identifiable {
    public struct Body: Codable, Hashable, Sendable { public var kind: String; public var reason: String? }
    public var id: Int
    public var weekStart: String
    public var text: String
    public var status: String
    public var proposal: Body
}

public struct CoachPage: Codable, Hashable, Sendable {
    public var notes: [CoachNote]
    public var proposals: [Proposal]
    public var enabled: Bool
}

// MARK: - History, workouts, check-ins

public struct WorkoutAnalysis: Codable, Hashable, Sendable {
    public var minutesPerZone: [Double]?
    public var intensity: String?
    public var avgHr: Int?
    public var maxHr: Int?
}

public struct Split: Codable, Hashable, Sendable {
    public var km: Double
    public var sec: Double
    public init(km: Double, sec: Double) { self.km = km; self.sec = sec }
}

public struct WorkoutDetails: Codable, Hashable, Sendable {
    public var cadenceSpm: Double?
    public var powerW: Double?
    public var strideM: Double?
    public var groundContactMs: Double?
    public var verticalOscillationCm: Double?
    public var speedKmh: Double?
    public var totalKcal: Double?
    public var stepCount: Double?
    public var splits: [Split]?
    public init() {}
}

public struct Workout: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var source: String
    public var date: String
    public var start: String
    public var end: String?
    public var type: String
    public var durationMin: Double?
    public var distanceKm: Double?
    public var avgHr: Int?
    public var maxHr: Int?
    public var kcal: Double?
    public var analysis: WorkoutAnalysis?
    public var externalId: String?
    public var elevationM: Double?
    public var effort: Double?
    public var hrRecovery: Int?
    public var details: WorkoutDetails?
}

public struct Best: Codable, Hashable, Sendable {
    public var weight: Double
    public var reps: Double
    public var date: String
}

public struct History: Codable, Hashable, Sendable {
    public var sessions: [Session]
    public var bests: [String: Best]
    public var workouts: [Workout]
}

public struct Checkin: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var date: String
    public var weightKg: Double
    public var notes: String?
    public var bodyFatPct: Double?
    public var source: String?
    public var skipped: Bool?
}

public struct Checkins: Codable, Hashable, Sendable { public var checkins: [Checkin] }

// MARK: - Stats, metrics, settings

public struct Stats: Codable, Hashable, Sendable {
    public struct WeekBar: Codable, Hashable, Sendable {
        public var weekStart: String
        public var done: Int
        public var planned: Int
        public var holiday: Bool
    }
    public var streak: Int
    public var weeks: [WeekBar]
    public var programWeek: Int?
    public var totalSessions: Int
}

public struct FoodTotalsDay: Codable, Hashable, Sendable {
    public var date: String
    public var kcal: Double
    public var proteinG: Double
}

public struct MetricsPage: Codable, Hashable, Sendable {
    public var from: String
    public var to: String
    public var days: [String: [String: Double]]
    public var food: [FoodTotalsDay]?
    public var health: Summary.Health
}

public struct MetricsDay: Codable, Hashable, Sendable {
    public var date: String
    public var metrics: [String: Double]
    public init(date: String, metrics: [String: Double]) { self.date = date; self.metrics = metrics }
}

public struct MetricsResult: Codable, Hashable, Sendable {
    public var days: Int
    public var values: Int
}

public struct Reminders: Codable, Hashable, Sendable {
    public var enabled: Bool
    public var time: String
    public init(enabled: Bool, time: String) { self.enabled = enabled; self.time = time }
}

public struct Settings: Codable, Hashable, Sendable {
    public var targets: Targets
    public var voice: Bool
    public var haAnnounce: Bool
    public var maxHr: Double
    public var athlete: String
    public var reminders: Reminders
    public var debrief: Bool
}

public struct ServerHealth: Codable, Hashable, Sendable {
    public var ok: Bool
    public var version: String
    public var coach: Bool
    public var auth: Bool
    public var notify: [String]?
}

/// What the app uploads for one Health workout (POST /api/workouts).
public struct WorkoutUpload: Codable, Hashable, Sendable {
    public struct Sample: Codable, Hashable, Sendable {
        public var t: String
        public var hr: Double
        public init(t: String, hr: Double) { self.t = t; self.hr = hr }
    }
    public var source = "healthkit"
    public var externalId: String
    public var type: String
    public var start: String
    public var end: String
    public var durationMin: Double?
    public var distanceKm: Double?
    public var kcal: Double?
    public var avgHr: Double?
    public var maxHr: Double?
    public var elevationM: Double?
    public var effort: Double?
    public var hrRecovery: Double?
    public var samples: [Sample]
    public var details: WorkoutDetails?

    public init(externalId: String, type: String, start: String, end: String, samples: [Sample] = []) {
        self.externalId = externalId
        self.type = type
        self.start = start
        self.end = end
        self.samples = samples
    }
}

public struct Imported: Codable, Hashable, Sendable { public var imported: Int }
public struct Deleted: Codable, Hashable, Sendable { public var deleted: Bool }
public struct OK: Codable, Hashable, Sendable { public var ok: Bool? }
public struct LoginResult: Codable, Hashable, Sendable { public var ok: Bool; public var token: String? }
public struct AuthState: Codable, Hashable, Sendable { public var enabled: Bool; public var ok: Bool }
public struct ReadResult: Codable, Hashable, Sendable { public var unread: Int }
