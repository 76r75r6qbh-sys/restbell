import SwiftUI

/// One color per meaning, used the same way in the app, widgets and Live Activity.
enum Palette {
    static let kcal = Color.orange
    static let protein = Color.indigo
    // Activity ring colors, as in Apple Fitness.
    static let move = Color(red: 0.98, green: 0.07, blue: 0.31)
    static let exercise = Color(red: 0.42, green: 0.84, blue: 0.0)
    static let stand = Color(red: 0.0, green: 0.82, blue: 0.93)
    static let sleep = Color.indigo
    static let zones: [Color] = [.gray, .blue, .green, .orange, .red]

    static func recovery(_ level: String?) -> Color {
        switch level {
        case "good": .green
        case "ok": .yellow
        case "low": .red
        default: .secondary
        }
    }
}

enum DeepLink {
    static let today = URL(string: "restbell://today")!
    static let food = URL(string: "restbell://food")!
    static let logFood = URL(string: "restbell://food/new")!
    static let chat = URL(string: "restbell://chat")!
    static let session = URL(string: "restbell://session")!
    static let weighIn = URL(string: "restbell://weigh-in")!
}

extension View {
    /// Liquid Glass on iOS 26, a material on iOS 18. For floating controls only, never for content.
    @ViewBuilder
    func glassBackground<S: Shape>(in shape: S, interactive: Bool = false) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            self.glassEffect(interactive ? .regular.interactive() : .regular, in: shape)
        } else {
            self.background(.regularMaterial, in: shape)
        }
        #else
        self.background(.regularMaterial, in: shape)
        #endif
    }

    /// The prominent glass button style on iOS 26, bordered prominent before.
    @ViewBuilder
    func prominentButton() -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            self.buttonStyle(.glassProminent)
        } else {
            self.buttonStyle(.borderedProminent)
        }
        #else
        self.buttonStyle(.borderedProminent)
        #endif
    }

    /// Rounded, tabular digits for every number that can change.
    func numeric() -> some View {
        self.fontDesign(.rounded).monospacedDigit()
    }
}
