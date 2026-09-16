/// <reference types="vite/client" />

interface Window {
  __cutout?: Record<string, unknown>;
  __workerLog?: Array<{
    url: string;
    type: string;
    post: { type?: string }[];
    msg: { type?: string }[];
    err: { msg: string }[];
  }>;
}
