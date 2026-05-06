export type Item = {
  id: string;
  name: string;
  price: number;
  claimedBy?: string | null;
};

export const mockBill = {
  code: "TONY42",
  restaurant: "Tony's Pizza",
  items: [
    { id: "1", name: "Margherita Pizza", price: 18.0, claimedBy: "Alex" },
    { id: "2", name: "Pepperoni Pizza", price: 21.0, claimedBy: null },
    { id: "3", name: "Caesar Salad", price: 12.5, claimedBy: "Will" },
    { id: "4", name: "Garlic Knots", price: 8.0, claimedBy: null },
    { id: "5", name: "Truffle Pasta", price: 24.0, claimedBy: null },
    { id: "6", name: "Tiramisu", price: 9.5, claimedBy: "Jennifer" },
    { id: "7", name: "House Red (Glass)", price: 11.0, claimedBy: null },
    { id: "8", name: "Sparkling Water", price: 8.5, claimedBy: null },
  ] as Item[],
  tax: 4.2,
  tipPercent: 18,
  guests: ["Jennifer", "Alex", "Will"],
};
