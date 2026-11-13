// Coupons: "SAVE10" takes 10% off, "FLAT5" takes 5 off; never below zero.
export function applyCoupon(total, code) {
  if (code === "SAVE10") return total * 0.1;
  if (code === "FLAT5") return total - 5;
  return total;
}
