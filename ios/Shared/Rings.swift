import SwiftUI
import RestbellKit

/// A single progress ring. Past 100 % a second lap draws over the first, like the Activity rings.
struct ProgressRing: View {
    var progress: Double
    var color: Color
    var lineWidth: CGFloat = 10

    var body: some View {
        ZStack {
            Circle().stroke(color.opacity(0.18), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: min(max(progress, 0), 1))
                .stroke(color.gradient, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            if progress > 1 {
                Circle()
                    .trim(from: 0, to: min(progress - 1, 1))
                    .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .shadow(color: .black.opacity(0.25), radius: 2)
            }
        }
        .padding(lineWidth / 2)
        .animation(.spring(duration: 0.6), value: progress)
    }
}

/// Concentric rings, outermost first.
struct RingStack: View {
    struct Ring: Identifiable {
        var id: String
        var progress: Double
        var color: Color
    }
    var rings: [Ring]
    var lineWidth: CGFloat = 10
    var gap: CGFloat = 2

    var body: some View {
        ZStack {
            ForEach(Array(rings.enumerated()), id: \.element.id) { i, ring in
                ProgressRing(progress: ring.progress, color: ring.color, lineWidth: lineWidth)
                    .padding(CGFloat(i) * (lineWidth + gap))
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

extension Summary.Food {
    var kcalProgress: Double { targets.kcal > 0 ? kcal / targets.kcal : 0 }
    var proteinProgress: Double { targets.proteinG > 0 ? proteinG / targets.proteinG : 0 }
}

extension Summary.Activity {
    var hasRings: Bool { moveGoal != nil || exerciseGoal != nil || standGoal != nil }
    func ratio(_ v: Double?, _ goal: Double?) -> Double { guard let v, let goal, goal > 0 else { return 0 } ; return v / goal }
    var rings: [RingStack.Ring] {
        [.init(id: "move", progress: ratio(moveKcal, moveGoal), color: Palette.move),
         .init(id: "exercise", progress: ratio(exerciseMin, exerciseGoal), color: Palette.exercise),
         .init(id: "stand", progress: ratio(standHours, standGoal), color: Palette.stand)]
    }
}

/// Calories and protein for the day as two rings with the numbers beside them.
struct MacroRings: View {
    var food: Summary.Food
    var compact = false

    var body: some View {
        HStack(spacing: compact ? 10 : 16) {
            RingStack(rings: [
                .init(id: "kcal", progress: food.kcalProgress, color: Palette.kcal),
                .init(id: "protein", progress: food.proteinProgress, color: Palette.protein),
            ], lineWidth: compact ? 8 : 12)
            .frame(width: compact ? 58 : 92)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: compact ? 4 : 8) {
                MacroLine(label: "Calories", value: food.kcal, target: food.targets.kcal, unit: "kcal", color: Palette.kcal, compact: compact)
                MacroLine(label: "Protein", value: food.proteinG, target: food.targets.proteinG, unit: "g", color: Palette.protein, compact: compact)
            }
        }
    }
}

struct MacroLine: View {
    var label: String
    var value: Double
    var target: Double
    var unit: String
    var color: Color
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label).font(compact ? .caption2 : .caption).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(Fmt.number(value)).font(compact ? .headline : .title3.weight(.semibold)).foregroundStyle(color)
                    .contentTransition(.numericText(value: value))
                Text("/ \(Fmt.number(target)) \(unit)").font(compact ? .caption2 : .footnote).foregroundStyle(.secondary)
            }
            .numeric()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue("\(Fmt.number(value)) of \(Fmt.number(target)) \(unit == "g" ? "grams" : "kilocalories")")
    }
}

/// A small labelled number with an SF Symbol.
struct StatTile: View {
    var title: String
    var value: String
    var detail: String? = nil
    var symbol: String
    var tint: Color = .accentColor

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(tint)
                .symbolRenderingMode(.hierarchical)
            Text(value).font(.title2.weight(.semibold)).numeric()
                .contentTransition(.numericText())
            if let detail {
                Text(detail).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// Minutes in each heart-rate zone as one segmented bar.
struct ZoneBar: View {
    var minutes: [Double]

    var body: some View {
        let total = max(minutes.reduce(0, +), 0.0001)
        GeometryReader { geo in
            HStack(spacing: 2) {
                ForEach(Array(minutes.enumerated()), id: \.offset) { i, m in
                    if m > 0 {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Palette.zones[min(i, 4)].gradient)
                            .frame(width: max(3, (geo.size.width - 8) * m / total))
                    }
                }
            }
        }
        .frame(height: 8)
        .accessibilityElement()
        .accessibilityLabel("Heart rate zones")
        .accessibilityValue(minutes.enumerated().map { "zone \($0.offset + 1): \(Int($0.element)) minutes" }.joined(separator: ", "))
    }
}
