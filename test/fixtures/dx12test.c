// A tiny DirectX 12 program for testing: opens a window, clears it to a moving colour for 180 frames
// through a real D3D12 swap chain, then writes the result next to itself (dx12test.txt) and exits.
// Pass "stay" to keep drawing until the window is closed (for Make it run tests).
// Build: x86_64-w64-mingw32-gcc -O2 -o dx12test.exe dx12test.c -ld3d12 -ldxgi -mwindows
#define COBJMACROS
#include <windows.h>
#include <d3d12.h>
#include <dxgi1_4.h>
#include <stdio.h>
#include <math.h>
#include <string.h>

static FILE *out;
static void done(const char *msg, HRESULT hr) { fprintf(out, "%s 0x%08lx\n", msg, (unsigned long)hr); fclose(out); ExitProcess(hr ? 1 : 0); }
#define CHECK(x, what) do { HRESULT _h = (x); if (FAILED(_h)) done("FAIL " what, _h); } while (0)

static LRESULT CALLBACK wndproc(HWND h, UINT m, WPARAM w, LPARAM l) { if (m == WM_DESTROY) PostQuitMessage(0); return DefWindowProcW(h, m, w, l); }

int WINAPI WinMain(HINSTANCE inst, HINSTANCE prev, LPSTR cmd, int show) {
  wchar_t path[MAX_PATH]; GetModuleFileNameW(NULL, path, MAX_PATH);
  wcscpy(wcsrchr(path, L'\\') + 1, L"dx12test.txt");
  out = _wfopen(path, L"w");
  WNDCLASSW wc = { 0 }; wc.lpfnWndProc = wndproc; wc.hInstance = inst; wc.lpszClassName = L"dx12test";
  RegisterClassW(&wc);
  HWND hwnd = CreateWindowW(L"dx12test", L"DropExe DX12 test", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 100, 100, 640, 400, 0, 0, inst, 0);

  IDXGIFactory4 *factory; CHECK(CreateDXGIFactory1(&IID_IDXGIFactory4, (void **)&factory), "CreateDXGIFactory1");
  IDXGIAdapter1 *adapter; CHECK(IDXGIFactory4_EnumAdapters1(factory, 0, &adapter), "EnumAdapters1");
  DXGI_ADAPTER_DESC1 ad; IDXGIAdapter1_GetDesc1(adapter, &ad);
  ID3D12Device *dev; CHECK(D3D12CreateDevice((IUnknown *)adapter, D3D_FEATURE_LEVEL_12_0, &IID_ID3D12Device, (void **)&dev), "D3D12CreateDevice");

  D3D12_COMMAND_QUEUE_DESC qd = { 0 }; qd.Type = D3D12_COMMAND_LIST_TYPE_DIRECT;
  ID3D12CommandQueue *queue; CHECK(ID3D12Device_CreateCommandQueue(dev, &qd, &IID_ID3D12CommandQueue, (void **)&queue), "CreateCommandQueue");
  DXGI_SWAP_CHAIN_DESC1 sd = { 0 }; sd.Width = 640; sd.Height = 400; sd.Format = DXGI_FORMAT_R8G8B8A8_UNORM; sd.SampleDesc.Count = 1;
  sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT; sd.BufferCount = 2; sd.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
  IDXGISwapChain1 *sc1; CHECK(IDXGIFactory4_CreateSwapChainForHwnd(factory, (IUnknown *)queue, hwnd, &sd, NULL, NULL, &sc1), "CreateSwapChainForHwnd");
  IDXGISwapChain3 *sc; CHECK(IDXGISwapChain1_QueryInterface(sc1, &IID_IDXGISwapChain3, (void **)&sc), "SwapChain3");

  D3D12_DESCRIPTOR_HEAP_DESC hd = { 0 }; hd.Type = D3D12_DESCRIPTOR_HEAP_TYPE_RTV; hd.NumDescriptors = 2;
  ID3D12DescriptorHeap *heap; CHECK(ID3D12Device_CreateDescriptorHeap(dev, &hd, &IID_ID3D12DescriptorHeap, (void **)&heap), "CreateDescriptorHeap");
  UINT inc = ID3D12Device_GetDescriptorHandleIncrementSize(dev, D3D12_DESCRIPTOR_HEAP_TYPE_RTV);
  D3D12_CPU_DESCRIPTOR_HANDLE base; heap->lpVtbl->GetCPUDescriptorHandleForHeapStart(heap, &base);
  ID3D12Resource *bufs[2];
  for (int i = 0; i < 2; i++) {
    CHECK(IDXGISwapChain3_GetBuffer(sc, i, &IID_ID3D12Resource, (void **)&bufs[i]), "GetBuffer");
    D3D12_CPU_DESCRIPTOR_HANDLE h = { base.ptr + i * inc };
    ID3D12Device_CreateRenderTargetView(dev, bufs[i], NULL, h);
  }
  ID3D12CommandAllocator *alloc; CHECK(ID3D12Device_CreateCommandAllocator(dev, D3D12_COMMAND_LIST_TYPE_DIRECT, &IID_ID3D12CommandAllocator, (void **)&alloc), "CreateCommandAllocator");
  ID3D12GraphicsCommandList *list; CHECK(ID3D12Device_CreateCommandList(dev, 0, D3D12_COMMAND_LIST_TYPE_DIRECT, alloc, NULL, &IID_ID3D12GraphicsCommandList, (void **)&list), "CreateCommandList");
  ID3D12GraphicsCommandList_Close(list);
  ID3D12Fence *fence; CHECK(ID3D12Device_CreateFence(dev, 0, D3D12_FENCE_FLAG_NONE, &IID_ID3D12Fence, (void **)&fence), "CreateFence");
  HANDLE ev = CreateEventW(NULL, FALSE, FALSE, NULL);
  UINT64 fv = 0;
  LARGE_INTEGER f, t0, t1; QueryPerformanceFrequency(&f); QueryPerformanceCounter(&t0);
  const int FRAMES = 180, stay = strstr(GetCommandLineA(), "stay") != NULL; // "stay": keep drawing until closed
  for (int n = 0; n < FRAMES || stay; n++) {
    if (stay && !IsWindow(hwnd)) break;
    MSG msg; while (PeekMessageW(&msg, 0, 0, 0, PM_REMOVE)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
    UINT i = IDXGISwapChain3_GetCurrentBackBufferIndex(sc);
    ID3D12CommandAllocator_Reset(alloc);
    ID3D12GraphicsCommandList_Reset(list, alloc, NULL);
    D3D12_RESOURCE_BARRIER b = { 0 }; b.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION; b.Transition.pResource = bufs[i];
    b.Transition.Subresource = D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES; b.Transition.StateBefore = D3D12_RESOURCE_STATE_PRESENT; b.Transition.StateAfter = D3D12_RESOURCE_STATE_RENDER_TARGET;
    ID3D12GraphicsCommandList_ResourceBarrier(list, 1, &b);
    float t = n / 30.0f, col[4] = { 0.55f + 0.45f * sinf(t), 0.3f, 0.55f + 0.45f * cosf(t), 1 };
    D3D12_CPU_DESCRIPTOR_HANDLE h = { base.ptr + i * inc };
    ID3D12GraphicsCommandList_ClearRenderTargetView(list, h, col, 0, NULL);
    b.Transition.StateBefore = D3D12_RESOURCE_STATE_RENDER_TARGET; b.Transition.StateAfter = D3D12_RESOURCE_STATE_PRESENT;
    ID3D12GraphicsCommandList_ResourceBarrier(list, 1, &b);
    ID3D12GraphicsCommandList_Close(list);
    ID3D12CommandList *lists[] = { (ID3D12CommandList *)list };
    ID3D12CommandQueue_ExecuteCommandLists(queue, 1, lists);
    CHECK(IDXGISwapChain3_Present(sc, 1, 0), "Present");
    ID3D12CommandQueue_Signal(queue, fence, ++fv);
    if (ID3D12Fence_GetCompletedValue(fence) < fv) { ID3D12Fence_SetEventOnCompletion(fence, fv, ev); WaitForSingleObject(ev, 5000); }
  }
  QueryPerformanceCounter(&t1);
  double secs = (double)(t1.QuadPart - t0.QuadPart) / f.QuadPart;
  char name[128]; WideCharToMultiByte(CP_UTF8, 0, ad.Description, -1, name, sizeof name, NULL, NULL);
  fprintf(out, "OK frames=%d fps=%.0f adapter=%s\n", FRAMES, FRAMES / secs, name);
  fclose(out);
  return 0;
}
