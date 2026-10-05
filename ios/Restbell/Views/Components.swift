import SwiftUI
import RestbellKit

/// A grouped card on the system grouped background, like the cards in Fitness and Health.
struct Card<Content: View>: View {
    var title: String?
    var symbol: String?
    var tint: Color = .secondary
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title {
                Label {
                    Text(title)
                } icon: {
                    if let symbol { Image(systemName: symbol) }
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tint)
                .symbolRenderingMode(.hierarchical)
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 22, style: .continuous))
    }
}

/// The transient message shown at the top of the app.
struct BannerView: View {
    var text: String
    var body: some View {
        Text(text)
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .glassBackground(in: Capsule())
            .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
            .padding(.top, 8)
            .transition(.move(edge: .top).combined(with: .opacity))
            .accessibilityAddTraits(.isStaticText)
    }
}

/// A − value + control with a large rounded number, for weights and reps.
struct ValueStepper: View {
    var title: String
    @Binding var value: Double
    var step: Double
    var unit: String
    var format: (Double) -> String = { $0.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int($0))" : String(format: "%.1f", $0) }

    var body: some View {
        VStack(spacing: 6) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
            HStack(spacing: 4) {
                Button { value = max(0, value - step) } label: {
                    Image(systemName: "minus").font(.title3.weight(.semibold)).frame(width: 48, height: 48)
                }
                .buttonStyle(.bordered).buttonBorderShape(.circle)
                .accessibilityLabel("Less \(title.lowercased())")
                Text(format(value))
                    .font(.system(.largeTitle, design: .rounded, weight: .semibold)).monospacedDigit()
                    .contentTransition(.numericText(value: value))
                    .frame(minWidth: 84)
                    .animation(.snappy, value: value)
                Button { value += step } label: {
                    Image(systemName: "plus").font(.title3.weight(.semibold)).frame(width: 48, height: 48)
                }
                .buttonStyle(.bordered).buttonBorderShape(.circle)
                .accessibilityLabel("More \(title.lowercased())")
            }
            Text(unit).font(.footnote).foregroundStyle(.secondary)
        }
        .sensoryFeedback(.selection, trigger: value)
        .accessibilityElement(children: .contain)
        .accessibilityValue("\(format(value)) \(unit)")
    }
}

extension View {
    func groupedBackground() -> some View {
        background(Color(.systemGroupedBackground).ignoresSafeArea())
    }
}
