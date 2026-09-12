import { AppError } from "@/domain/models";
import type { PublishBridge } from "./PublishBridge";

const unsupported = () => Promise.reject(new AppError("PLATFORM_UNSUPPORTED", "Publishing on Vinted needs the desktop app.", { retryable: false }));

/** Web and mobile: the flow is not available yet (a native plugin will implement PublishBridge later). */
export class UnsupportedBridge implements PublishBridge {
  readonly supported = false;
  open: PublishBridge["open"] = unsupported;
  navigate: PublishBridge["navigate"] = unsupported;
  prefill: PublishBridge["prefill"] = unsupported;
  poll: PublishBridge["poll"] = unsupported;
  close: PublishBridge["close"] = () => Promise.resolve();
  clearSession: PublishBridge["clearSession"] = unsupported;
  onPage: PublishBridge["onPage"] = () => () => undefined;
  onClosed: PublishBridge["onClosed"] = () => () => undefined;
}
