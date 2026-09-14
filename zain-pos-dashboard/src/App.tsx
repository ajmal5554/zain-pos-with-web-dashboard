import * as React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DateFilterProvider } from './contexts/DateFilterContext';
import { DashboardLayout } from './components/layout/DashboardLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Sales from './pages/Sales';
import Inventory from './pages/Inventory';
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 px-6">
      <div className="flex flex-col items-center gap-6 w-full max-w-xs">
        {/* App Icon */}
        <div className="h-16 w-16 flex items-center justify-center rounded-[1.25rem] bg-slate-950 p-3 shadow-sm dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <img src="/icon.ico" className="h-full w-full object-contain rounded-lg" alt="Zain POS Logo" />
        </div>
        
        {/* Black/White Loading Bar */}
        <div className="w-28 h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-slate-950 dark:bg-slate-50" />
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
              <Sales />
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
