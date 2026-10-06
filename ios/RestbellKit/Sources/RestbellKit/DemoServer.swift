import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// An in-memory stand-in for the Restbell server with a believable week of data.
/// Used by SwiftUI previews, demo mode and the CI screenshots; it answers the same routes as src/api.js.
public actor DemoServer: Transport {
    public static let baseURL = URL(string: "https://demo.restbell.invalid")!
    public static let shared = DemoServer()

    let today: String
    var food: [FoodEntry]
    var favorites: [Favorite]
    var chat: [ChatMessage]
    var session: Session?
    var nextId = 1000
    var settings: Settings
    var replyDelay: Duration

    public init(today: String = DayString.today(), replyDelay: Duration = .seconds(2)) {
        self.today = today
        self.replyDelay = replyDelay
        favorites = [
            Favorite(id: 1, name: "Protein shake", text: "protein shake with milk", kcal: 260, proteinG: 38),
            Favorite(id: 2, name: "Oats & berries", text: "oats with berries and yoghurt", kcal: 480, proteinG: 24),
            Favorite(id: 3, name: "Chicken rice bowl", text: "chicken, rice and vegetables", kcal: 650, proteinG: 48),
        ]
        food = [
            FoodEntry(id: 1, date: today, text: "Oats with berries and yoghurt", kcal: 480, proteinG: 24, createdAt: nil),
            FoodEntry(id: 2, date: today, text: "Protein shake with milk", kcal: 260, proteinG: 38, createdAt: nil),
            FoodEntry(id: 3, date: today, text: "Chicken, rice and vegetables", kcal: 650, proteinG: 48, createdAt: nil),
        ]
        let yesterday = ISOTime.string(Date().addingTimeInterval(-86400))
        chat = [
            ChatMessage(id: 1, role: "coach", kind: "review", text: "Solid week: all three sessions done and squat moved up 2.5 kg. Protein averaged 128 g, a bit under target — add a shake on lift days.", createdAt: yesterday, readAt: yesterday),
            ChatMessage(id: 2, role: "user", kind: "chat", text: "Slept badly last night. Should I still do Lift A?", createdAt: yesterday, readAt: yesterday),
            ChatMessage(id: 3, role: "coach", kind: "chat", text: "Yes, but keep 2–3 reps in reserve on every set and skip the last set of RDLs if your back feels tight. Your HRV is only slightly down, so this is a normal day with a softer top end.", createdAt: yesterday, readAt: nil),
        ]
        settings = Settings(targets: Targets(kcal: 2600, proteinG: 140), voice: true, haAnnounce: false, maxHr: 191, athlete: "", reminders: Reminders(enabled: true, time: "20:30"), debrief: true)
    }

    public func send(_ request: URLRequest) async throws -> (Data, Int) {
        let path = request.url?.path ?? ""
        let method = request.httpMethod ?? "GET"
        let body = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        let query = Dictionary(uniqueKeysWithValues: (URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        func ok<T: Encodable>(_ value: T) throws -> (Data, Int) { (try JSONEncoder().encode(value), 200) }

        switch (method, path) {
        case ("GET", "/api/health"): return try ok(ServerHealth(ok: true, version: "demo", coach: true, auth: false, notify: ["homeassistant"]))
        case ("GET", "/api/auth"): return try ok(AuthState(enabled: false, ok: true))
        case ("POST", "/api/login"): return try ok(LoginResult(ok: true, token: nil))
        case ("GET", "/api/summary"): return try ok(summary())
        case ("GET", "/api/today"): return try ok(todayPayload())
        case ("GET", "/api/stats"): return try ok(stats())
        case ("GET", "/api/food"): return try ok(foodDay())
        case ("GET", "/api/food/favorites"):
            return try ok(QuickFoods(favorites: favorites, recent: food.map { RecentMeal(text: $0.text, kcal: $0.kcal, proteinG: $0.proteinG, date: today) }))
        case ("POST", "/api/food/estimate"):
            let text = body["text"] as? String ?? "meal"
            try? await Task.sleep(for: .milliseconds(800))
            return try ok(FoodEstimate(items: [.init(name: text, kcal: 420, proteinG: 32)], kcal: 420, proteinG: 32, note: "Assumed a regular portion."))
        case ("POST", "/api/food"):
            let entry = FoodEntry(id: newId(), date: today, text: body["text"] as? String ?? "meal", kcal: body["kcal"] as? Double ?? 0, proteinG: body["proteinG"] as? Double ?? 0, createdAt: nil)
            food.append(entry)
            return try ok(entry)
        case ("GET", "/api/chat"):
            let after = Int(query["after"] ?? "") ?? 0
            return try ok(ChatPage(messages: chat.filter { $0.id > after }, pending: pending, unread: chat.filter { $0.readAt == nil }.count, enabled: true))
        case ("POST", "/api/chat"):
            let msg = ChatMessage(id: newId(), role: "user", kind: "chat", text: body["text"] as? String ?? "", createdAt: ISOTime.string(Date()), readAt: ISOTime.string(Date()))
            chat.append(msg)
            pending = true
            Task { await self.reply(to: msg.text) }
            return try ok(ChatSent(message: msg, pending: true))
        case ("POST", "/api/chat/read"):
            for i in chat.indices where chat[i].readAt == nil { chat[i].readAt = ISOTime.string(Date()) }
            return try ok(ReadResult(unread: 0))
        case ("GET", "/api/coach"): return try ok(coachPage())
        case ("GET", "/api/history"): return try ok(history())
        case ("GET", "/api/checkins"): return try ok(Checkins(checkins: checkins()))
        case ("GET", "/api/settings"): return try ok(settings)
        case ("GET", "/api/metrics"): return try ok(metricsPage(from: query["from"] ?? today, to: query["to"] ?? today))
        case ("POST", "/api/sessions"):
            let s = Session(id: newId(), date: today, dayKey: body["dayKey"] as? String ?? "A", type: "lift", startedAt: ISOTime.string(Date()), sets: [])
            session = s
            return try ok(s)
        case ("PUT", "/api/metrics"): return try ok(MetricsResult(days: 0, values: 0))
        case ("POST", "/api/workouts"): return try ok(Imported(imported: 0))
        default:
            if method == "POST", path.hasSuffix("/sets"), var s = session {
                let set = LoggedSet(exerciseId: body["exerciseId"] as? String ?? "", exerciseName: body["exerciseName"] as? String, setIndex: body["setIndex"] as? Int ?? 0,
                                    targetReps: body["targetReps"] as? Int, reps: body["reps"] as? Double ?? 0, weight: body["weight"] as? Double ?? 0)
                s.sets = (s.sets ?? []).filter { !($0.exerciseId == set.exerciseId && $0.setIndex == set.setIndex) } + [set]
                session = s
                return try ok(set)
            }
            if method == "POST", path.hasSuffix("/finish"), var s = session {
                s.finishedAt = ISOTime.string(Date())
                session = s
                return try ok(FinishResult(session: s, changes: []))
            }
            if method == "DELETE" || path.contains("/proposals/") { return try ok(OK(ok: true)) }
            return (Data(#"{"error":"not in the demo"}"#.utf8), 404)
        }
    }

    var pending = false

    func reply(to text: String) async {
        try? await Task.sleep(for: replyDelay)
        chat.append(ChatMessage(id: newId(), role: "coach", kind: "chat", text: "Good question. In the demo I can't see your data, but on your own server I'd answer \"\(text.prefix(60))\" with your logs and Watch data in mind.", createdAt: ISOTime.string(Date()), readAt: nil))
        pending = false
    }

    func newId() -> Int { nextId += 1; return nextId }

    // MARK: Data

    static let liftA = Day(key: "A", weekday: 1, time: "07:30", type: "lift", title: "Lift A · full body", targetDistanceKm: nil, cue: nil, exercises: [
        Exercise(id: "squat", name: "Back squat", sets: 3, repMin: 5, repMax: 5, weight: 62.5, increment: 2.5, restSec: 150, cue: "Sit between your heels, chest up, drive the floor away.", unit: nil),
        Exercise(id: "bench", name: "Bench press", sets: 3, repMin: 6, repMax: 8, weight: 52.5, increment: 2.5, restSec: 120, cue: "Feet planted, shoulder blades pinched, bar to lower chest.", unit: nil),
        Exercise(id: "cable_row", name: "Seated cable row", sets: 3, repMin: 8, repMax: 10, weight: 45, increment: 5, restSec: 90, cue: "Pull elbows to hips, squeeze the shoulder blades.", unit: nil),
        Exercise(id: "plank", name: "Plank", sets: 2, repMin: 30, repMax: 45, weight: nil, increment: nil, restSec: 60, cue: "Ribs down, squeeze glutes.", unit: "sec"),
    ])

    func todayPayload() -> Today {
        Today(date: today, programName: "Return to lifting — full body ×2 + run", programNotes: nil, day: Self.liftA, openSession: session?.finishedAt == nil ? session : nil,
              lastSession: LastSession(date: DayString.adding(-7, to: today), feel: 4, notes: nil, sets: [
                  LoggedSet(exerciseId: "squat", exerciseName: "Back squat", setIndex: 0, targetReps: 5, reps: 5, weight: 60),
                  LoggedSet(exerciseId: "bench", exerciseName: "Bench press", setIndex: 0, targetReps: 8, reps: 8, weight: 50),
              ]),
              days: [DayRef(key: "A", weekday: 1, title: "Lift A · full body", type: "lift", time: "07:30"), DayRef(key: "B", weekday: 4, title: "Lift B · full body", type: "lift", time: "07:30"), DayRef(key: "R", weekday: 6, title: "Easy run · 5–7 km", type: "run", time: "09:00")])
    }

    func foodDay() -> FoodDay {
        let t = food.filter { $0.date == today }
        return FoodDay(date: today, entries: t, totals: .init(kcal: t.map(\.kcal).reduce(0, +), proteinG: t.map(\.proteinG).reduce(0, +)), targets: settings.targets, estimator: true)
    }

    func summary() -> Summary {
        let f = foodDay()
        var s = Summary.sample(today: today, favorites: favorites.map { .init(id: $0.id, name: $0.name, kcal: $0.kcal, proteinG: $0.proteinG) })
        s.food = .init(kcal: f.totals.kcal, proteinG: f.totals.proteinG, entries: f.entries.count, targets: settings.targets)
        s.session.status = session.map { $0.finishedAt == nil ? "active" : "done" } ?? "planned"
        s.session.sessionId = session?.id
        s.session.setsDone = session?.sets?.count ?? 0
        s.unreadChat = chat.filter { $0.readAt == nil }.count
        s.energy = .init(date: today, outKcal: 2210, inKcal: f.totals.kcal, balance: f.totals.kcal - 2210)
        return s
    }

    func stats() -> Stats {
        let done = [3, 3, 2, 3, 3, 3, 3, 1]
        return Stats(streak: 6, weeks: done.enumerated().map { i, d in .init(weekStart: DayString.adding(-7 * (7 - i), to: today), done: d, planned: 3, holiday: false) }, programWeek: 9, totalSessions: 24)
    }

    func coachPage() -> CoachPage {
        CoachPage(notes: [CoachNote(id: 1, weekStart: DayString.adding(-7, to: today), text: "Solid week: all three sessions done and squat moved up 2.5 kg.\n\nWins\n- Every set of bench hit 8 reps\n- Easy run stayed in zone 2\n\nWatch\n- Protein averaged 128 g, under the 140 g target\n\nNext week\n- Add a shake on lift days\n- Keep the run easy", createdAt: ISOTime.string(Date().addingTimeInterval(-86400)))],
                  proposals: [Proposal(id: 1, weekStart: DayString.adding(-7, to: today), text: "Raise protein to 150 g a day", status: "open", proposal: .init(kind: "targets", reason: "Weight is dropping faster than planned."))],
                  enabled: true)
    }

    func history() -> History {
        let run = Workout(id: 7, source: "healthkit", date: DayString.adding(-1, to: today), start: ISOTime.string(Date().addingTimeInterval(-86400)), end: nil, type: "Running", durationMin: 34, distanceKm: 6.2, avgHr: 148, maxHr: 171, kcal: 412,
                          analysis: WorkoutAnalysis(minutesPerZone: [2, 9, 17, 6, 0], intensity: "moderate", avgHr: 148, maxHr: 171), externalId: "demo-run", elevationM: 38, effort: 6, hrRecovery: 31,
                          details: { var d = WorkoutDetails(); d.cadenceSpm = 168; d.powerW = 236; d.strideM = 1.08; d.groundContactMs = 251; d.verticalOscillationCm = 8.4
                              d.splits = [Split(km: 1, sec: 334), Split(km: 1, sec: 328), Split(km: 1, sec: 330), Split(km: 1, sec: 325), Split(km: 1, sec: 321), Split(km: 1, sec: 312), Split(km: 0.2, sec: 61)]; return d }())
        let sets = [LoggedSet(exerciseId: "squat", exerciseName: "Back squat", setIndex: 0, targetReps: 5, reps: 5, weight: 60), LoggedSet(exerciseId: "squat", exerciseName: "Back squat", setIndex: 1, targetReps: 5, reps: 5, weight: 60), LoggedSet(exerciseId: "bench", exerciseName: "Bench press", setIndex: 0, targetReps: 8, reps: 8, weight: 50)]
        return History(sessions: [Session(id: 20, date: DayString.adding(-3, to: today), dayKey: "B", type: "lift", startedAt: ISOTime.string(Date().addingTimeInterval(-3 * 86400)), finishedAt: ISOTime.string(Date().addingTimeInterval(-3 * 86400 + 3600)), feel: 4, notes: "Felt strong", workoutId: nil, sets: sets)],
                       bests: ["squat": Best(weight: 62.5, reps: 5, date: today)], workouts: [run])
    }

    func checkins() -> [Checkin] {
        [77.2, 77.0, 76.9, 76.8, 76.6, 76.4].enumerated().reversed().map { i, w in Checkin(id: i, date: DayString.adding(-7 * (5 - i), to: today), weightKg: w, notes: nil, bodyFatPct: nil, source: "manual", skipped: nil) }
    }

    func metricsPage(from: String, to: String) -> MetricsPage {
        var food: [FoodTotalsDay] = []
        for i in 0..<28 {
            let kcal: Double = 2350 + Double((i * 53) % 9) * 60
            let protein: Double = 120 + Double((i * 29) % 7) * 6
            food.append(FoodTotalsDay(date: DayString.adding(-i, to: today), kcal: kcal, proteinG: protein))
        }
        let health = Summary.Health(lastSync: ISOTime.string(Date().addingTimeInterval(-1800)), stale: false)
        return MetricsPage(from: from, to: to, days: metrics(), food: food, health: health)
    }

    /// 28 days of plausible Watch data.
    func metrics() -> [String: [String: Double]] {
        var out: [String: [String: Double]] = [:]
        for i in 0..<28 {
            let d = DayString.adding(-i, to: today)
            let w: Double = Double((i * 37) % 11) - 5
            var m: [String: Double] = [:]
            m["steps"] = 8200 + w * 600
            m["active_kcal"] = 560 + w * 30
            m["basal_kcal"] = 1780
            m["exercise_min"] = 34 + w * 2
            m["stand_hours"] = 11
            m["move_goal_kcal"] = 600
            m["exercise_goal_min"] = 30
            m["stand_goal_hours"] = 12
            m["resting_hr"] = 52 + w / 3
            m["hrv_ms"] = 52 - w
            m["sleep_min"] = 440 + w * 8
            m["sleep_deep_min"] = 62 + w
            m["sleep_core_min"] = 250 + w * 4
            m["sleep_rem_min"] = 110 + w * 2
            m["vo2max"] = 46.5
            out[d] = m
        }
        return out
    }
}

extension Summary {
    /// A believable day, for widget placeholders and previews.
    public static func sample(today: String = DayString.today(), favorites: [FavoriteRef]? = nil) -> Summary {
        Summary(
            date: today,
            food: .init(kcal: 1390, proteinG: 110, entries: 3, targets: Targets(kcal: 2600, proteinG: 140)),
            session: .init(status: "planned", dayKey: "A", title: "Lift A · full body", type: "lift", time: "07:30", sessionId: nil, setsDone: 0, setsTotal: 11),
            week: .init(start: DayString.adding(-2, to: today), done: 1, planned: 3, remaining: 2, holiday: false),
            streak: 6,
            bodyweight: .init(kg: 76.4, date: DayString.adding(-2, to: today), delta: -0.6, over: 4),
            unreadChat: 1,
            lastWorkout: .init(id: 7, date: DayString.adding(-1, to: today), type: "Running", durationMin: 34, distanceKm: 6.2, kcal: 412, avgHr: 148, intensity: "moderate", minutesPerZone: [2, 9, 17, 6, 0], effort: 6),
            activity: .init(moveKcal: 420, moveGoal: 600, exerciseMin: 22, exerciseGoal: 30, standHours: 8, standGoal: 12, steps: 7840, sleepMin: 442),
            energy: .init(date: today, outKcal: 2210, inKcal: 1390, balance: -820),
            recovery: .init(level: "ok", score: 62, reasons: ["HRV 9 % below your usual"]),
            health: .init(lastSync: nil, stale: false),
            favorites: favorites ?? [
                .init(id: 1, name: "Protein shake", kcal: 260, proteinG: 38),
                .init(id: 2, name: "Oats & berries", kcal: 480, proteinG: 24),
                .init(id: 3, name: "Chicken rice bowl", kcal: 650, proteinG: 48),
            ]
        )
    }
}
