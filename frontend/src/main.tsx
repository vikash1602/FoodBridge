import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";

import App from "./App";
import "./index.css";
import "leaflet/dist/leaflet.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            borderRadius: "14px",
            background: "#1E4533",
            color: "#FAF6EC",
            fontWeight: 600,
            boxShadow: "0 10px 30px -8px rgba(0,0,0,.4)",
          },
          success: { iconTheme: { primary: "#E3A733", secondary: "#1E1812" } },
          error: { iconTheme: { primary: "#E14B2E", secondary: "#FAF6EC" } },
        }}
      />
    </QueryClientProvider>
  </StrictMode>,
);
