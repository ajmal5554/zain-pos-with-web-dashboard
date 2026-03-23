import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DateFilterProvider } from './contexts/DateFilterContext';
import { DashboardLayout } from './components/layout/DashboardLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Sales from './pages/Sales';
import Inventory from './pages/Inventory';
import Invoices from './pages/Invoices';
import Reports from './pages/Reports';
import ActivityPage from './pages/Activity';
import ProductsPage from './pages/Products';
import CustomersPage from './pages/Customers';
import ForecastingPage from './pages/Forecasting';
import UsersPage from './pages/Users';
import PermissionsPage from './pages/Permissions';
import SettingsPage from './pages/Settings';
import './index.css';
import { Sparkles } from 'lucide-react';

function AppBootScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_30%),linear-gradient(180deg,_#f8fbff_0%,_#edf3fb_100%)] px-6 text-slate-900 dark:bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.14),_transparent_30%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)] dark:text-slate-100">
      <div className="w-full max-w-sm rounded-[2rem] border border-slate-200/80 bg-white/[0.88] p-8 text-center shadow-[0_30px_80px_-36px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/[0.84]">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-slate-950 text-white shadow-[0_20px_40px_-20px_rgba(15,23,42,0.9)] dark:bg-sky-400 dark:text-slate-950">
          <Sparkles className="h-7 w-7" />
        </div>
        <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.3em] text-sky-700 dark:text-sky-300">
          Zain Gents Palace
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Commerce Console</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Preparing session, permissions, and live store data.
        </p>
        <div className="mt-6 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-900">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-sky-500" />
        </div>
      </div>
    </div>
  );
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <AppBootScreen />;
  }

  return user ? <>{children}</> : <Navigate to="/login" />;
}

function AppRoutes() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" /> : <Login />}
      />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <DashboardLayout>
              <Dashboard />
            </DashboardLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/sales"
        element={
          <PrivateRoute>
            <DashboardLayout>
              <Sales />
            </DashboardLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/inventory"
        element={
          <PrivateRoute>
            <DashboardLayout>
              <Inventory />
            </DashboardLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/products"
        element={
          <PrivateRoute>
            <DashboardLayout>
              <ProductsPage />
            </DashboardLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/customers"
        element={
          <PrivateRoute>
            <DashboardLayout>
              <CustomersPage />
            </DashboardLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/invoices"
        element={
          <PrivateRoute>
            <DashboardLayout>
              <Invoices />
            </DashboardLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <PrivateRoute>
            <DashboardLayout>
              <Reports />
            </DashboardLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/forecasting"
        element={
          <PrivateRoute>
            <DashboardLayout>
              <ForecastingPage />
            </DashboardLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/users"
        element={
          <PrivateRoute>
            <DashboardLayout>
              <UsersPage />
            </DashboardLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/permissions"
        element={
          <PrivateRoute>
            <DashboardLayout>
              <PermissionsPage />
            </DashboardLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <PrivateRoute>
            <DashboardLayout>
              <SettingsPage />
            </DashboardLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/activity"
        element={
          <PrivateRoute>
            <DashboardLayout>
              <ActivityPage />
            </DashboardLayout>
          </PrivateRoute>
        }
      />
    </Routes>
  );
}

import { Toaster } from 'react-hot-toast';
import { NotificationProvider } from './contexts/NotificationContext';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NotificationProvider>
          <DateFilterProvider>
            <Toaster position="top-right" />
            <AppRoutes />
          </DateFilterProvider>
        </NotificationProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
