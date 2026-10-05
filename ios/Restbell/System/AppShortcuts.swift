import AppIntents
import RestbellKit

/// Logs a weigh-in by voice or from the Action Button.
struct LogWeightIntent: AppIntent {
    static let title: LocalizedStringResource = "Log weight"
    static let description = IntentDescription("Adds today's weigh-in to Restbell.")

    @Parameter(title: "Weight (kg)", inclusiveRange: (20, 300))
    var kilograms: Double

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let api = SharedStore.client() else { throw IntentFailure.notSignedIn }
        let c = try await api.addCheckin(.init(weightKg: kilograms))
        return .result(dialog: "Logged \(Fmt.kg(c.weightKg)).")
    }
}

/// Runs the Apple Health import. Add it to a Shortcuts automation ("When Apple Watch workout ends",
/// or a few times a day) for the most reliable background sync on a free developer account.
struct SyncHealthIntent: AppIntent {
    static let title: LocalizedStringResource = "Sync Apple Health"
    static let description = IntentDescription("Sends new Apple Watch workouts and today's health metrics to your Restbell server.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let report = await HealthSync.shared.sync(trigger: .shortcut)
        return .result(dialog: "\(report.summary)")
    }
}

struct RestbellShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: OpenFoodLoggerIntent(), phrases: ["Log food in \(.applicationName)", "Log a meal in \(.applicationName)"],
                    shortTitle: "Log food", systemImageName: "fork.knife")
        AppShortcut(intent: LogFavoriteIntent(), phrases: ["Log \(\.$meal) in \(.applicationName)"],
                    shortTitle: "Log a favorite", systemImageName: "star")
        AppShortcut(intent: StartWorkoutIntent(), phrases: ["Start my workout in \(.applicationName)", "Start today's session in \(.applicationName)"],
                    shortTitle: "Start workout", systemImageName: "figure.strengthtraining.traditional")
        AppShortcut(intent: LogWeightIntent(), phrases: ["Log my weight in \(.applicationName)"],
                    shortTitle: "Log weight", systemImageName: "scalemass")
        AppShortcut(intent: SyncHealthIntent(), phrases: ["Sync Apple Health with \(.applicationName)"],
                    shortTitle: "Sync Health", systemImageName: "heart.text.square")
    }
}
