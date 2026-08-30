import { ToastProvider } from "@/app/ToastProvider";
import AppRoutes from "@/routes/AppRoutes";

export function App() {
  return (
    <ToastProvider>
      <AppRoutes />
    </ToastProvider>
  );
}

export default App;