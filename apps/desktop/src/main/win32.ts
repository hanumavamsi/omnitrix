// The few user32 calls Electron doesn't expose, via koffi (no native build step).
import koffi from "koffi";

const user32 = koffi.load("user32.dll");

export const keybd_event = user32.func(
	"void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr extra)",
);
export const GetAsyncKeyState = user32.func(
	"int16 __stdcall GetAsyncKeyState(int vk)",
);
export const GetClipboardSequenceNumber = user32.func(
	"uint32 __stdcall GetClipboardSequenceNumber()",
);
export const GetForegroundWindow = user32.func(
	"void * __stdcall GetForegroundWindow()",
);
export const SetForegroundWindow = user32.func(
	"bool __stdcall SetForegroundWindow(void *hwnd)",
);
export const IsWindow = user32.func("bool __stdcall IsWindow(void *hwnd)");
export const GetWindowThreadProcessId = user32.func(
	"uint32 __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)",
);
