import SwiftUI
import RestbellKit

struct FoodView: View {
    @Environment(AppModel.self) private var model
    @State private var day: FoodDay?
    @State private var quick: QuickFoods?
    @State private var logged = 0

    var body: some View {
        NavigationStack {
            List {
                if let day {
                    Section {
                        MacroRings(food: .init(kcal: day.totals.kcal, proteinG: day.totals.proteinG, entries: day.entries.count, targets: day.targets))
                            .padding(.vertical, 6)
                        if let e = model.summary?.energy {
                            LabeledContent("Burned so far") { Text("\(Fmt.number(e.outKcal)) kcal").numeric() }
                            LabeledContent("Balance") {
                                Text(e.balance >= 0 ? "+\(Fmt.number(e.balance)) kcal" : "\(Fmt.number(e.balance)) kcal").numeric()
                                    .foregroundStyle(e.balance >= 0 ? Color.green : Color.orange)
                            }
                        }
                    }
                }
                if let favorites = quick?.favorites, !favorites.isEmpty {
                    Section("Favorites") {
                        ForEach(favorites) { f in
                            QuickRow(title: f.name, kcal: f.kcal, protein: f.proteinG) {
                                await add(text: f.text, kcal: f.kcal, protein: f.proteinG, label: f.name)
                            }
                            .swipeActions {
                                Button("Delete", role: .destructive) { Task { _ = try? await model.api?.deleteFavorite(id: f.id); await load() } }
                            }
                        }
                    }
                }
                if let day {
                    Section("Today") {
                        if day.entries.isEmpty {
                            Text("Nothing logged yet.").foregroundStyle(.secondary)
                        }
                        ForEach(day.entries.reversed()) { e in
                            HStack {
                                Text(e.text).lineLimit(2)
                                Spacer()
                                VStack(alignment: .trailing) {
                                    Text("\(Fmt.number(e.kcal)) kcal").font(.subheadline).numeric()
                                    Text("\(Fmt.number(e.proteinG)) g protein").font(.caption).foregroundStyle(.secondary).numeric()
                                }
                            }
                            .swipeActions {
                                Button("Delete", role: .destructive) { Task { _ = try? await model.api?.deleteFood(id: e.id); await reload() } }
                            }
                            .contextMenu {
                                Button("Log Again", systemImage: "arrow.clockwise") { Task { await add(text: e.text, kcal: e.kcal, protein: e.proteinG, label: nil) } }
                                Button("Save as Favorite", systemImage: "star") {
                                    Task { _ = try? await model.api?.addFavorite(name: String(e.text.prefix(30)), text: e.text, kcal: e.kcal, proteinG: e.proteinG); await load() }
                                }
                            }
                        }
                    }
                }
                if let recent = quick?.recent.filter({ r in !(day?.entries.contains { $0.text == r.text } ?? false) }), !recent.isEmpty {
                    Section("Recent") {
                        ForEach(recent.prefix(8), id: \.text) { r in
                            QuickRow(title: r.text, kcal: r.kcal, protein: r.proteinG) { await add(text: r.text, kcal: r.kcal, protein: r.proteinG, label: nil) }
                        }
                    }
                }
            }
            .overlay { if day == nil { ProgressView() } }
            .navigationTitle("Food")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Log Food", systemImage: "plus") { model.showLogFood = true }
                }
            }
            .refreshable { await load() }
            .task { await load() }
            .onChange(of: model.showLogFood) { _, showing in if !showing { Task { await reload() } } }
            .sensoryFeedback(.success, trigger: logged)
        }
    }

    func load() async {
        guard let api = model.api else { return }
        async let d = api.food()
        async let q = api.quickFoods()
        day = try? await d
        quick = try? await q
    }

    func reload() async {
        day = try? await model.api?.food()
        await model.didLog()
    }

    func add(text: String, kcal: Double, protein: Double, label: String?) async {
        guard let api = model.api else { return }
        do {
            _ = try await api.addFood(.init(text: text, kcal: kcal, proteinG: protein))
            HealthSync.shared.saveMealIfEnabled(kcal: kcal, proteinG: protein, name: text)
            logged += 1
            model.flash("Logged \(label ?? text)")
            await reload()
        } catch {
            model.flash(error.localizedDescription)
        }
    }
}

struct QuickRow: View {
    var title: String
    var kcal: Double
    var protein: Double
    var action: () async -> Void
    @State private var tapped = 0

    var body: some View {
        Button {
            tapped += 1
            Task { await action() }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(.primary).lineLimit(1)
                    Text("\(Fmt.number(kcal)) kcal · \(Fmt.number(protein)) g protein").font(.caption).foregroundStyle(.secondary).numeric()
                }
                Spacer()
                Image(systemName: "plus.circle.fill")
                    .font(.title2)
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(Color.accentColor)
                    .symbolEffect(.bounce, value: tapped)
            }
        }
        .accessibilityLabel("Log \(title)")
        .accessibilityValue("\(Fmt.number(kcal)) kilocalories, \(Fmt.number(protein)) grams protein")
    }
}

/// Describe a meal, let the coach estimate it, adjust, save. Numbers can also go in by hand.
struct LogFoodSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var kcal: Double = 0
    @State private var protein: Double = 0
    @State private var estimate: FoodEstimate?
    @State private var estimating = false
    @State private var saveFavorite = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("2 eggs, toast with butter, coffee with milk", text: $text, axis: .vertical)
                        .lineLimit(2...5)
                        .focused($focused)
                    Button {
                        Task { await runEstimate() }
                    } label: {
                        HStack {
                            Label("Estimate", systemImage: "sparkles")
                            Spacer()
                            if estimating { ProgressView() }
                        }
                    }
                    .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || estimating)
                } header: {
                    Text("What did you eat?")
                } footer: {
                    Text("The coach estimates calories and protein; check the numbers before saving.")
                }
                if let estimate, estimate.items.count > 1 || !estimate.note.isEmpty {
                    Section("Estimate") {
                        ForEach(estimate.items, id: \.name) { item in
                            LabeledContent(item.name) { Text("\(Fmt.number(item.kcal)) kcal · \(Fmt.number(item.proteinG)) g").numeric() }
                        }
                        if !estimate.note.isEmpty { Text(estimate.note).font(.footnote).foregroundStyle(.secondary) }
                    }
                }
                Section("Numbers") {
                    LabeledContent("Calories") {
                        TextField("kcal", value: $kcal, format: .number).keyboardType(.numberPad).multilineTextAlignment(.trailing).numeric()
                    }
                    LabeledContent("Protein") {
                        TextField("g", value: $protein, format: .number).keyboardType(.decimalPad).multilineTextAlignment(.trailing).numeric()
                    }
                    Toggle("Save as favorite", isOn: $saveFavorite)
                }
                if let error { Section { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange) } }
            }
            .navigationTitle("Log Food")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.disabled(kcal <= 0 || text.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium, .large])
    }

    func runEstimate() async {
        guard let api = model.api else { return }
        estimating = true
        error = nil
        defer { estimating = false }
        do {
            let e = try await api.estimate(text)
            estimate = e
            kcal = e.kcal.rounded()
            protein = e.proteinG.rounded()
        } catch APIError.server(503, _) {
            error = "The estimator is unavailable. Enter the numbers by hand."
        } catch {
            self.error = error.localizedDescription
        }
    }

    func save() async {
        guard let api = model.api, kcal > 0 else { return }
        let p = protein
        do {
            _ = try await api.addFood(.init(text: text, kcal: kcal, proteinG: p))
            if saveFavorite { _ = try? await api.addFavorite(name: String(text.prefix(30)), text: text, kcal: kcal, proteinG: p) }
            HealthSync.shared.saveMealIfEnabled(kcal: kcal, proteinG: p, name: text)
            model.flash("Logged \(Fmt.number(kcal)) kcal")
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct WeighInSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var weight: Double = 75
    @State private var notes = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ValueStepper(title: "Weight", value: $weight, step: 0.1, unit: "kg", format: { String(format: "%.1f", $0) })
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                Section { TextField("Note (optional)", text: $notes) }
            }
            .navigationTitle("Weigh In")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            do {
                                _ = try await model.api?.addCheckin(.init(weightKg: (weight * 10).rounded() / 10, notes: notes.isEmpty ? nil : notes))
                                model.flash("Saved \(Fmt.kg((weight * 10).rounded() / 10))")
                                await model.didLog()
                                dismiss()
                            } catch { model.flash(error.localizedDescription) }
                        }
                    }
                }
            }
            .onAppear { if let kg = model.summary?.bodyweight?.kg { weight = kg } }
        }
        .presentationDetents([.medium])
    }
}
