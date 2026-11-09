import type { API } from "../shared/api";
declare global {
  interface Window {
    readingDesk: API;
  }
}
