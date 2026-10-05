import XCTest
@testable import RestbellKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Records requests and returns canned JSON.
final class StubTransport: Transport, @unchecked Sendable {
    var requests: [URLRequest] = []
    var responses: [String: (Int, String)] = [:]
    func send(_ request: URLRequest) async throws -> (Data, Int) {
        requests.append(request)
        let key = "\(request.httpMethod ?? "GET") \(request.url!.path)"
        let (status, body) = responses[key] ?? (404, #"{"error":"no stub for \#(key)"}"#)
        return (Data(body.utf8), status)
    }
}

final class GuideTests: XCTestCase {
    // Same cases as test/guide.test.js, so the app and the PWA agree.
    let exercises = [
        Exercise(id: "squat", name: "Squat", sets: 3), Exercise(id: "bench", name: "Bench", sets: 3), Exercise(id: "crunch", name: "Crunch", sets: 2),
    ]
    func set(_ id: String, _ i: Int) -> LoggedSet { LoggedSet(exerciseId: id, exerciseName: nil, setIndex: i, targetReps: 5, reps: 5, weight: 40) }
    func ids(_ steps: [GuideStep]) -> [String] { steps.map { "\(exercises[$0.index].id)\($0.setIndex + 1)" } }

    func testLoggedCountIgnoresDuplicatesAndOutOfRange() {
        let sets = [set("squat", 0), set("squat", 0), set("squat", 2), set("squat", 5), set("bench", 1)]
        XCTAssertEqual(Guide.loggedCount(exercises[0], in: sets), 2)
        XCTAssertEqual(Guide.loggedCount(exercises[1], in: sets), 1)
    }

    func testRounds() {
        XCTAssertEqual(ids(Guide.openSteps(exercises, logged: [], order: .rounds)), ["squat1", "bench1", "crunch1", "squat2", "bench2", "crunch2", "squat3", "bench3"])
        XCTAssertEqual(Guide.rounds(exercises), 3)
    }

    func testResumeSkipsLoggedSets() {
        let sets = [set("squat", 0), set("bench", 0), set("crunch", 0), set("bench", 1)]
        XCTAssertEqual(ids(Guide.openSteps(exercises, logged: sets, order: .rounds)), ["squat2", "crunch2", "squat3", "bench3"])
        XCTAssertEqual(ids(Guide.openSteps(exercises, logged: sets, order: .straight)), ["squat2", "squat3", "bench3", "crunch2"])
    }

    func testAllLogged() {
        let all = exercises.flatMap { e in (0..<e.sets).map { set(e.id, $0) } }
        XCTAssertTrue(Guide.openSteps(exercises, logged: all, order: .rounds).isEmpty)
        XCTAssertTrue(Guide.openSteps(exercises, logged: all, order: .straight).isEmpty)
    }

    func testStraight() {
        XCTAssertEqual(ids(Guide.openSteps(exercises, logged: [], order: .straight)), ["squat1", "squat2", "squat3", "bench1", "bench2", "bench3", "crunch1", "crunch2"])
    }

    func testOrderForDayType() {
        XCTAssertEqual(GuideOrder.forDay(type: "lift"), .straight)
        XCTAssertEqual(GuideOrder.forDay(type: "home"), .rounds)
        XCTAssertEqual(GuideOrder.forDay(type: "travel"), .rounds)
    }

    func testPrefill() {
        let ex = Exercise(id: "squat", name: "Squat", sets: 3, repMin: 5, repMax: 5, weight: 60)
        XCTAssertEqual(Guide.prefill(ex, setIndex: 0, session: [], lastTime: []).weight, 60)
        XCTAssertEqual(Guide.prefill(ex, setIndex: 1, session: [LoggedSet(exerciseId: "squat", exerciseName: nil, setIndex: 0, targetReps: 5, reps: 5, weight: 62.5)], lastTime: []).weight, 62.5)
        let timed = Exercise(id: "plank", name: "Plank", sets: 2, repMin: 30, repMax: 45, unit: "sec")
        XCTAssertEqual(Guide.prefill(timed, setIndex: 0, session: [], lastTime: []).reps, 45)
    }
}

extension Exercise {
    init(id: String, name: String, sets: Int, repMin: Int? = nil, repMax: Int? = nil, weight: Double? = nil, unit: String? = nil) {
        self.init(id: id, name: name, sets: sets, repMin: repMin, repMax: repMax, weight: weight, increment: nil, restSec: nil, cue: nil, unit: unit)
    }
}

final class FormattingTests: XCTestCase {
    func testTargets() {
        XCTAssertEqual(Fmt.target(Exercise(id: "a", name: "A", sets: 3, repMin: 6, repMax: 8, weight: 52.5)), "6–8 × 52.5 kg")
        XCTAssertEqual(Fmt.target(Exercise(id: "a", name: "A", sets: 3, repMin: 5, repMax: 5, weight: 60)), "5 × 60 kg")
        XCTAssertEqual(Fmt.target(Exercise(id: "a", name: "A", sets: 3, repMin: 10, repMax: 12)), "10–12 reps")
        XCTAssertEqual(Fmt.target(Exercise(id: "p", name: "P", sets: 2, repMin: 30, repMax: 45, unit: "sec")), "45 s")
    }
    func testClockPaceSleep() {
        XCTAssertEqual(Fmt.clock(90), "1:30")
        XCTAssertEqual(Fmt.clock(3725), "1:02:05")
        XCTAssertEqual(Fmt.pace(minutes: 30, km: 6), "5:00/km")
        XCTAssertNil(Fmt.pace(minutes: 30, km: 0))
        XCTAssertEqual(Fmt.sleep(445), "7 h 25")
        XCTAssertEqual(Fmt.kg(62.5), "62.5 kg")
        XCTAssertEqual(Fmt.kg(60), "60 kg")
    }
    func testDays() {
        XCTAssertEqual(DayString.adding(1, to: "2026-10-31"), "2026-11-01")
        XCTAssertEqual(DayString.adding(-1, to: "2026-03-01"), "2026-02-28")
    }
}

final class HealthMathTests: XCTestCase {
    let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    func testDisplayNames() {
        XCTAssertEqual(HealthMath.displayName(caseName: "traditionalStrengthTraining"), "Traditional Strength Training")
        XCTAssertEqual(HealthMath.displayName(caseName: "running"), "Running")
    }

    func testSplitsInterpolateKmBoundaries() {
        // 2.5 km at a steady 5:00/km, in 500 m samples of 150 s.
        let samples = (0..<5).map { i in HealthMath.DistanceSample(start: t0.addingTimeInterval(Double(i) * 150), end: t0.addingTimeInterval(Double(i + 1) * 150), meters: 500) }
        let s = HealthMath.splits(from: samples, workoutStart: t0)
        XCTAssertEqual(s.map(\.sec), [300, 300, 150])
        XCTAssertEqual(s.last?.km, 0.5)
    }

    func testShortRemainderIsDropped() {
        let samples = [HealthMath.DistanceSample(start: t0, end: t0.addingTimeInterval(330), meters: 1100)]
        XCTAssertEqual(HealthMath.splits(from: samples, workoutStart: t0).count, 1)
    }

    func testHeartRateRecovery() {
        let end = t0.addingTimeInterval(1800)
        let samples = [HealthMath.HRSample(time: end.addingTimeInterval(-10), bpm: 168), HealthMath.HRSample(time: end.addingTimeInterval(-2), bpm: 170),
                       HealthMath.HRSample(time: end.addingTimeInterval(58), bpm: 139), HealthMath.HRSample(time: end.addingTimeInterval(120), bpm: 120)]
        XCTAssertEqual(HealthMath.hrRecovery(samples: samples, workoutEnd: end), 30)
        XCTAssertNil(HealthMath.hrRecovery(samples: Array(samples.prefix(2)), workoutEnd: end))
    }

    func testSleepNightUnionsOverlappingSources() {
        let midnight = t0
        let s: [HealthMath.SleepSample] = [
            .init(start: midnight.addingTimeInterval(-3600), end: midnight.addingTimeInterval(7 * 3600), stage: .inBed),
            .init(start: midnight.addingTimeInterval(-1800), end: midnight.addingTimeInterval(3600), stage: .core),
            .init(start: midnight.addingTimeInterval(3600), end: midnight.addingTimeInterval(2 * 3600), stage: .deep),
            .init(start: midnight.addingTimeInterval(2 * 3600), end: midnight.addingTimeInterval(2.25 * 3600), stage: .awake),
            .init(start: midnight.addingTimeInterval(2.25 * 3600), end: midnight.addingTimeInterval(6.5 * 3600), stage: .rem),
            // The phone also logged "asleep" over part of the same time: must not double count.
            .init(start: midnight, end: midnight.addingTimeInterval(3 * 3600), stage: .asleep),
        ]
        let n = HealthMath.sleepNight(s, wakeDay: midnight)!
        XCTAssertEqual(n.asleepMin, 7 * 60)    // -0:30 → 6:30, the awake gap is covered by the phone's "asleep"
        XCTAssertEqual(n.deepMin, 60)
        XCTAssertEqual(n.awakeMin, 15)
        XCTAssertEqual(n.bedtimeMin, -30)
        XCTAssertEqual(n.wakeMin, 390)
        XCTAssertEqual(n.metrics["sleep_min"], 420)
        XCTAssertNil(HealthMath.sleepNight([], wakeDay: midnight))
    }

    func testSanitizeDropsUnknownAndOutOfRange() {
        XCTAssertEqual(HealthMath.sanitized(["steps": 100, "hrv_ms": 0, "mood": 3, "resting_hr": .nan]), ["steps": 100])
    }
}

final class APIClientTests: XCTestCase {
    func testBearerHeaderAndQuery() async throws {
        let stub = StubTransport()
        stub.responses["GET /api/chat"] = (200, #"{"messages":[{"id":5,"role":"coach","kind":"chat","text":"Hi","createdAt":"2026-10-05T10:00:00.000Z","readAt":null}],"pending":false,"unread":1,"enabled":true}"#)
        let api = APIClient(baseURL: URL(string: "https://trainer.example")!, token: "abc", transport: stub)
        let page = try await api.chat(after: 4)
        XCTAssertEqual(page.messages.first?.text, "Hi")
        XCTAssertEqual(stub.requests[0].value(forHTTPHeaderField: "Authorization"), "Bearer abc")
        XCTAssertEqual(stub.requests[0].url?.query, "after=4")
    }

    func testErrorsMapToAPIError() async {
        let stub = StubTransport()
        stub.responses["GET /api/summary"] = (401, #"{"error":"login required"}"#)
        stub.responses["POST /api/chat"] = (503, #"{"error":"The coach is off"}"#)
        let api = APIClient(baseURL: URL(string: "https://trainer.example")!, token: nil, transport: stub)
        do { _ = try await api.summary(); XCTFail() } catch { XCTAssertEqual(error as? APIError, .unauthorized) }
        do { _ = try await api.sendChat("x"); XCTFail() } catch { XCTAssertEqual(error as? APIError, .server(status: 503, message: "The coach is off")) }
    }

    func testDecodesServerSummary() throws {
        // Shape produced by buildSummary in src/api.js (copied from the server test run).
        let json = #"""
        {"date":"2026-10-09","food":{"kcal":0,"proteinG":0,"entries":0,"targets":{"kcal":2600,"proteinG":140}},
         "session":{"status":"rest"},"week":{"start":"2026-10-05","done":1,"planned":3,"remaining":2,"holiday":false},"streak":0,
         "bodyweight":null,"unreadChat":0,"lastWorkout":null,
         "activity":{"moveKcal":500,"moveGoal":null,"exerciseMin":null,"exerciseGoal":null,"standHours":null,"standGoal":null,"steps":4200,"sleepMin":320},
         "energy":{"date":"2026-10-09","outKcal":2300,"inKcal":0,"balance":-2300},
         "recovery":{"level":"low","score":31,"reasons":["HRV 40 % below your usual"]},
         "health":{"lastSync":"2026-10-09T08:00:00.000Z","stale":false},"favorites":[]}
        """#
        let s = try JSONDecoder().decode(Summary.self, from: Data(json.utf8))
        XCTAssertEqual(s.session.status, "rest")
        XCTAssertEqual(s.recovery?.level, "low")
        XCTAssertEqual(s.activity.steps, 4200)
    }
}

final class DemoServerTests: XCTestCase {
    func testDemoAnswersTheAppsMainRoutes() async throws {
        let api = APIClient(baseURL: DemoServer.baseURL, token: nil, transport: DemoServer(today: "2026-10-05", replyDelay: .milliseconds(10)))
        let summary = try await api.summary(date: "2026-10-05")
        XCTAssertEqual(summary.food.entries, 3)
        let today = try await api.today()
        XCTAssertEqual(today.day?.exercises.count, 4)
        _ = try await api.history()
        _ = try await api.coach()
        _ = try await api.metrics(from: "2026-09-08", to: "2026-10-05")
        let sent = try await api.sendChat("How was my week?")
        XCTAssertTrue(sent.pending)
        try await Task.sleep(for: .milliseconds(100))
        let after = try await api.chat(after: sent.message.id)
        XCTAssertEqual(after.messages.count, 1)
        XCTAssertFalse(after.pending)
    }
}

final class SetQueueTests: XCTestCase {
    func testQueueReplacesSameSetAndFlushes() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let q = SetQueue(directory: dir)
        await q.enqueue(sessionId: 1, LoggedSet(exerciseId: "squat", exerciseName: nil, setIndex: 0, targetReps: 5, reps: 4, weight: 60))
        await q.enqueue(sessionId: 1, LoggedSet(exerciseId: "squat", exerciseName: nil, setIndex: 0, targetReps: 5, reps: 5, weight: 60))
        let count = await q.count
        XCTAssertEqual(count, 1)
        let reloaded = await SetQueue(directory: dir).count
        XCTAssertEqual(reloaded, 1) // persisted
        let stub = StubTransport()
        stub.responses["POST /api/sessions/1/sets"] = (200, #"{"exerciseId":"squat","setIndex":0,"reps":5,"weight":60}"#)
        let sent = await q.flush(using: APIClient(baseURL: URL(string: "https://x.example")!, token: nil, transport: stub))
        XCTAssertEqual(sent, 1)
        let left = await q.count
        XCTAssertEqual(left, 0)
    }
}
