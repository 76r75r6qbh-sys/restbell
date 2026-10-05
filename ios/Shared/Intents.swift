import AppIntents
import Foundation
import RestbellKit
#if canImport(WidgetKit)
import WidgetKit
#endif

enum IntentFailure: Error, CustomLocalizedStringResourceConvertible {
    case notSignedIn
    var localizedStringResource: LocalizedStringResource { "Open Restbell and sign in first." }
}

// MARK: - Favorites (widgets, Siri, Shortcuts)

struct FavoriteEntity: AppEntity, Identifiable {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Favorite meal"
    static let defaultQuery = FavoriteQuery()

    var id: Int
    var name: String
    var kcal: Double
    var proteinG: Double

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: "\(Int(kcal)) kcal · \(Int(proteinG)) g protein")
    }

    init(id: Int, name: String, kcal: Double, proteinG: Double) {
        self.id = id; self.name = name; self.kcal = kcal; self.proteinG = proteinG
    }
    init(_ f: Summary.FavoriteRef) { self.init(id: f.id, name: f.name, kcal: f.kcal, proteinG: f.proteinG) }
}

struct FavoriteQuery: EntityQuery {
    func entities(for identifiers: [Int]) async throws -> [FavoriteEntity] {
        try await suggestedEntities().filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [FavoriteEntity] {
        let cached = (SharedStore.cachedSummary?.favorites ?? []).map(FavoriteEntity.init)
        guard let api = SharedStore.client() else { return cached }
        do {
            return try await api.quickFoods().favorites.map { FavoriteEntity(id: $0.id, name: $0.name, kcal: $0.kcal, proteinG: $0.proteinG) }
        } catch {
            return cached // offline: the widget's cached list is good enough to pick from
        }
    }
}

/// Logs a favorite meal without opening the app (widget buttons, Siri, quick actions).
struct LogFavoriteIntent: AppIntent {
    static let title: LocalizedStringResource = "Log a favorite meal"
    static let description = IntentDescription("Adds one of your favorite meals to today's food log.")

    @Parameter(title: "Meal")
    var meal: FavoriteEntity

    init() {}
    init(meal: FavoriteEntity) { self.meal = meal }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let api = SharedStore.client() else { throw IntentFailure.notSignedIn }
        _ = try await api.addFood(.init(text: meal.name, kcal: meal.kcal, proteinG: meal.proteinG))
        if let summary = try? await api.summary() { SharedStore.cachedSummary = summary }
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
        return .result(dialog: "Logged \(meal.name): \(Int(meal.kcal)) kcal, \(Int(meal.proteinG)) g protein.")
    }
}

// MARK: - Opening the app at a screen

/// Opens the food logger with the keyboard up (Control Center, Action Button, Siri).
struct OpenFoodLoggerIntent: AppIntent {
    static let title: LocalizedStringResource = "Log food"
    static let description = IntentDescription("Opens Restbell ready to describe a meal.")

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(DeepLink.logFood))
    }
}

struct StartWorkoutIntent: AppIntent {
    static let title: LocalizedStringResource = "Start today's workout"
    static let description = IntentDescription("Opens Restbell on today's session.")

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(DeepLink.session))
    }
}

// MARK: - Live Activity buttons

enum WorkoutAction: String, Sendable {
    case logPrescribed, addRest, skipRest
}

/// The app sets this at launch; Live Activity intents run in the app's process and call it.
enum WorkoutIntentBridge {
    nonisolated(unsafe) static var handler: (@Sendable (WorkoutAction) async -> Void)?
}

struct LogPrescribedSetIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Log set as prescribed"
    static let isDiscoverable = false
    func perform() async throws -> some IntentResult {
        await WorkoutIntentBridge.handler?(.logPrescribed)
        return .result()
    }
}

struct AddRestIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Add 30 seconds of rest"
    static let isDiscoverable = false
    func perform() async throws -> some IntentResult {
        await WorkoutIntentBridge.handler?(.addRest)
        return .result()
    }
}

struct SkipRestIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Skip rest"
    static let isDiscoverable = false
    func perform() async throws -> some IntentResult {
        await WorkoutIntentBridge.handler?(.skipRest)
        return .result()
    }
}
