import { afterEach } from "vitest";
import { resetCircleStore } from "@/lib/store-loader";

afterEach(() => {
  resetCircleStore();
});