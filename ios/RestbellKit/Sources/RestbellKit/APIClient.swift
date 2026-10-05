import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum APIError: Error, LocalizedError, Equatable {
    case unauthorized
    case server(status: Int, message: String)
    case offline(String)
    case decoding(String)

    public var errorDescription: String? {
        switch self {
        case .unauthorized: "Sign in again: the server didn't accept the saved password."
        case let .server(_, message): message
        case let .offline(message): "Can't reach the server. \(message)"
        case let .decoding(message): "The server sent something unexpected (\(message))."
        }
    }

    /// True when the request never reached the server, so it is safe to queue and retry.
    public var isOffline: Bool { if case .offline = self { true } else { false } }
}

/// Sends one HTTP request. URLSession in the app; a canned server in tests, previews and demo mode.
public protocol Transport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, Int)
}

public struct URLSessionTransport: Transport {
    let session: URLSession
    public init(timeout: TimeInterval = 30) {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = timeout
        session = URLSession(configuration: config)
    }
    public func send(_ request: URLRequest) async throws -> (Data, Int) {
        do {
            let (data, response) = try await session.data(for: request)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        } catch {
            throw APIError.offline(error.localizedDescription)
        }
    }
}

/// Typed client for the Restbell API. Authenticates with the bearer token from /api/login.
public struct APIClient: Sendable {
    public let baseURL: URL
    public let token: String?
    let transport: Transport

    public init(baseURL: URL, token: String?, transport: Transport = URLSessionTransport()) {
        self.baseURL = baseURL
        self.token = token
        self.transport = transport
    }

    static let encoder = JSONEncoder()
    static let decoder = JSONDecoder()

    func request(_ method: String, _ path: String, query: [String: String] = [:], body: Data? = nil) -> URLRequest {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
        var req = URLRequest(url: components.url!)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return req
    }

    struct ErrorBody: Decodable { let error: String }

    func call<T: Decodable>(_ method: String, _ path: String, query: [String: String] = [:], body: Data? = nil) async throws -> T {
        let (data, status) = try await transport.send(request(method, path, query: query, body: body))
        if status == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(status) else {
            let message = (try? Self.decoder.decode(ErrorBody.self, from: data))?.error ?? "Server error \(status)"
            throw APIError.server(status: status, message: message)
        }
        do {
            return try Self.decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding("\(path): \(error)")
        }
    }

    func call<T: Decodable, B: Encodable>(_ method: String, _ path: String, json: B) async throws -> T {
        try await call(method, path, body: try Self.encoder.encode(json))
    }

    // MARK: Auth and health

    public static func login(baseURL: URL, password: String, transport: Transport = URLSessionTransport()) async throws -> LoginResult {
        let client = APIClient(baseURL: baseURL, token: nil, transport: transport)
        do {
            return try await client.call("POST", "api/login", json: ["password": password])
        } catch APIError.unauthorized {
            throw APIError.server(status: 401, message: "Wrong password.")
        }
    }
    public func health() async throws -> ServerHealth { try await call("GET", "api/health") }
    public func auth() async throws -> AuthState { try await call("GET", "api/auth") }

    // MARK: Today and sessions

    public func summary(date: String = DayString.today()) async throws -> Summary { try await call("GET", "api/summary", query: ["date": date]) }
    public func today(date: String = DayString.today()) async throws -> Today { try await call("GET", "api/today", query: ["date": date]) }
    public func stats(date: String = DayString.today()) async throws -> Stats { try await call("GET", "api/stats", query: ["date": date]) }

    public func startSession(date: String = DayString.today(), dayKey: String) async throws -> Session {
        try await call("POST", "api/sessions", json: ["date": date, "dayKey": dayKey])
    }
    public func deleteSession(id: Int) async throws -> OK { try await call("DELETE", "api/sessions/\(id)") }
    public func logSet(sessionId: Int, _ set: LoggedSet) async throws -> LoggedSet {
        try await call("POST", "api/sessions/\(sessionId)/sets", json: set)
    }
    public func deleteSet(sessionId: Int, exerciseId: String, setIndex: Int) async throws -> OK {
        struct Body: Encodable { let exerciseId: String; let setIndex: Int }
        return try await call("DELETE", "api/sessions/\(sessionId)/sets", json: Body(exerciseId: exerciseId, setIndex: setIndex))
    }
    public struct FinishBody: Encodable, Sendable {
        public var feel: Int?
        public var notes: String?
        public var distanceKm: Double?
        public var durationMin: Double?
        public init(feel: Int? = nil, notes: String? = nil, distanceKm: Double? = nil, durationMin: Double? = nil) {
            self.feel = feel; self.notes = notes; self.distanceKm = distanceKm; self.durationMin = durationMin
        }
    }
    public func finishSession(id: Int, _ body: FinishBody) async throws -> FinishResult {
        try await call("POST", "api/sessions/\(id)/finish", json: body)
    }
    public func history(limit: Int = 30) async throws -> History { try await call("GET", "api/history", query: ["limit": String(limit)]) }
    public func workout(id: Int) async throws -> Workout { try await call("GET", "api/workouts/\(id)") }

    // MARK: Food

    public func food(date: String = DayString.today()) async throws -> FoodDay { try await call("GET", "api/food", query: ["date": date]) }
    public func quickFoods() async throws -> QuickFoods { try await call("GET", "api/food/favorites") }
    public func estimate(_ text: String) async throws -> FoodEstimate { try await call("POST", "api/food/estimate", json: ["text": text]) }
    public struct NewFood: Encodable, Sendable {
        public var date: String
        public var text: String
        public var kcal: Double
        public var proteinG: Double
        public init(date: String = DayString.today(), text: String, kcal: Double, proteinG: Double) {
            self.date = date; self.text = text; self.kcal = kcal; self.proteinG = proteinG
        }
    }
    public func addFood(_ food: NewFood) async throws -> FoodEntry { try await call("POST", "api/food", json: food) }
    public func deleteFood(id: Int) async throws -> OK { try await call("DELETE", "api/food/\(id)") }
    public func addFavorite(name: String, text: String, kcal: Double, proteinG: Double) async throws -> Favorite {
        struct Body: Encodable { let name: String; let text: String; let kcal: Double; let proteinG: Double }
        return try await call("POST", "api/food/favorites", json: Body(name: name, text: text, kcal: kcal, proteinG: proteinG))
    }
    public func deleteFavorite(id: Int) async throws -> OK { try await call("DELETE", "api/food/favorites/\(id)") }
    /// Log a favorite for today in one call.
    public func logFavorite(_ f: Summary.FavoriteRef, text: String? = nil, date: String = DayString.today()) async throws -> FoodEntry {
        try await addFood(NewFood(date: date, text: text ?? f.name, kcal: f.kcal, proteinG: f.proteinG))
    }

    // MARK: Check-ins

    public func checkins() async throws -> Checkins { try await call("GET", "api/checkins") }
    public struct NewCheckin: Encodable, Sendable {
        public var date: String
        public var weightKg: Double
        public var notes: String?
        public var bodyFatPct: Double?
        public var source: String?
        public init(date: String = DayString.today(), weightKg: Double, notes: String? = nil, bodyFatPct: Double? = nil, source: String? = nil) {
            self.date = date; self.weightKg = weightKg; self.notes = notes; self.bodyFatPct = bodyFatPct; self.source = source
        }
    }
    public func addCheckin(_ c: NewCheckin) async throws -> Checkin { try await call("POST", "api/checkins", json: c) }

    // MARK: Coach

    public func coach() async throws -> CoachPage { try await call("GET", "api/coach") }
    public func resolveProposal(id: Int, apply: Bool) async throws -> Proposal {
        try await call("POST", "api/coach/proposals/\(id)/\(apply ? "apply" : "dismiss")")
    }
    public func reviewNow(date: String = DayString.today()) async throws -> CoachNote { try await call("POST", "api/coach/review", json: ["date": date]) }
    public func chat(after: Int? = nil, limit: Int = 60) async throws -> ChatPage {
        try await call("GET", "api/chat", query: after.map { ["after": String($0)] } ?? ["limit": String(limit)])
    }
    public func sendChat(_ text: String) async throws -> ChatSent { try await call("POST", "api/chat", json: ["text": text]) }
    public func markChatRead() async throws -> ReadResult { try await call("POST", "api/chat/read", json: [String: Int]()) }

    // MARK: Settings

    public func settings() async throws -> Settings { try await call("GET", "api/settings") }
    public func updateSettings<B: Encodable>(_ patch: B) async throws -> Settings { try await call("PUT", "api/settings", json: patch) }

    // MARK: Apple Health

    public func uploadWorkouts(_ workouts: [WorkoutUpload]) async throws -> Imported {
        try await call("POST", "api/workouts", json: ["workouts": workouts])
    }
    public func deleteWorkout(externalId: String) async throws -> Deleted {
        let id = externalId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? externalId
        return try await call("DELETE", "api/workouts/external/\(id)")
    }
    public func putMetrics(_ days: [MetricsDay]) async throws -> MetricsResult { try await call("PUT", "api/metrics", json: ["days": days]) }
    public func metrics(from: String, to: String) async throws -> MetricsPage { try await call("GET", "api/metrics", query: ["from": from, "to": to]) }
}
