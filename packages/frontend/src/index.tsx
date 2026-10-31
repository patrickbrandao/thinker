import { StrictMode, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import App from './App.jsx';
import AuthLayout from './layouts/AuthLayout.jsx';
import RootRedirect from './components/RootRedirect.jsx';
import AgentGuard from './components/AgentGuard.jsx';
import AuthGuard from './components/AuthGuard.jsx';
import GuestGuard from './components/GuestGuard.jsx';
import MeGate from './components/MeGate.jsx';
import ToastContainer from './components/ToastContainer.jsx';
import NotFound from './pages/NotFound.jsx';
import { lazyReload, clearReloadFlag } from './services/lazy-reload.js';
import { RightSidebarProvider } from './services/right-sidebar.jsx';
import { cleanUpStoredHeaders } from './services/playground-request-headers.js';
import { removeLegacyStorageKeys } from './services/legacy-storage.js';
import { watchSystemTheme } from './lib/theme.js';
import { useLocale } from './i18n/index.js';
import './styles/index.css';

clearReloadFlag();
// Wipe Playground header values saved in plain text by older builds, even if
// the Playground is never opened again (#105). Never throws.
cleanUpStoredHeaders();
// Drop Web Storage keys left by pre-rename builds. Runs after the header
// cleanup above, which still reads header names from one of them.
removeLegacyStorageKeys();
watchSystemTheme();

const Workspace = lazyReload(() => import('./pages/Workspace.jsx'));
const GlobalOverview = lazyReload(() => import('./pages/GlobalOverview.jsx'));
const AgentDetail = lazyReload(() => import('./pages/AgentDetail.jsx'));
const AgentOverview = lazyReload(() => import('./pages/AgentOverview.jsx'));
const AgentProviders = lazyReload(() => import('./pages/AgentProviders.jsx'));
const AgentModels = lazyReload(() => import('./pages/AgentModels.jsx'));
const AgentLimitsRedirect = lazyReload(() => import('./pages/AgentLimitsRedirect.jsx'));
const AgentMessagesRedirect = lazyReload(() => import('./pages/AgentMessagesRedirect.jsx'));
const MessageLog = lazyReload(() => import('./pages/MessageLog.jsx'));
const Settings = lazyReload(() => import('./pages/Settings.jsx'));
const Routing = lazyReload(() => import('./pages/Routing.jsx'));
const Playground = lazyReload(() => import('./pages/Playground.jsx'));
const Limits = lazyReload(() => import('./pages/Limits.jsx'));
const Account = lazyReload(() => import('./pages/Account.jsx'));
const CliAuth = lazyReload(() => import('./pages/CliAuth.jsx'));
const Consent = lazyReload(() => import('./pages/Consent.jsx'));
const OauthError = lazyReload(() => import('./pages/OauthError.jsx'));
const Login = lazyReload(() => import('./pages/Login.jsx'));
const Register = lazyReload(() => import('./pages/Register.jsx'));
const ResetPassword = lazyReload(() => import('./pages/ResetPassword.jsx'));
const Setup = lazyReload(() => import('./pages/Setup.jsx'));
const Welcome = lazyReload(() => import('./pages/Welcome.jsx'));
const ModelPrices = lazyReload(() => import('./pages/ModelPrices.jsx'));
const Help = lazyReload(() => import('./pages/Help.jsx'));
const ConnectProvider = lazyReload(() => import('./pages/ConnectProvider.jsx'));
const Subscriptions = lazyReload(() => import('./pages/providers/Subscriptions.jsx'));
const Byok = lazyReload(() => import('./pages/providers/Byok.jsx'));
const LocalProviders = lazyReload(() => import('./pages/providers/Local.jsx'));
const ConnectionDetail = lazyReload(() => import('./pages/providers/ConnectionDetail.jsx'));
const McpServer = lazyReload(() => import('./pages/integrations/McpServer.jsx'));
const Cli = lazyReload(() => import('./pages/integrations/Cli.jsx'));
const Organization = lazyReload(() => import('./pages/Organization.jsx'));
const Triggers = lazyReload(() => import('./pages/Triggers.jsx'));
const AdminUsers = lazyReload(() => import('./pages/AdminUsers.jsx'));
const ChangePassword = lazyReload(() => import('./pages/ChangePassword.jsx'));
const Topology = lazyReload(() => import('./pages/Topology.jsx'));
const RequestPage = lazyReload(() => import('./pages/RequestPage.jsx'));

const Lazy = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<div className="page" aria-busy="true" />}>{children}</Suspense>
);

/** Sign-in screens: guest-only, on the auth card. */
const GuestLayout = () => (
  <GuestGuard>
    <AuthLayout>
      <Lazy>
        <Outlet />
      </Lazy>
    </AuthLayout>
  </GuestGuard>
);

// Full-page onboarding: authenticated but outside the dashboard shell. The
// embedded Playground step calls useRightSidebar, so the provider App
// normally supplies is recreated here.
const WelcomeLayout = () => (
  <AuthGuard>
    <MeGate>
      <RightSidebarProvider>
        <Lazy>
          <Outlet />
        </Lazy>
      </RightSidebarProvider>
    </MeGate>
  </AuthGuard>
);

// Forced password change: authenticated, outside the dashboard shell (which
// stays blocked until the change succeeds).
const ChangePasswordLayout = () => (
  <AuthGuard>
    <AuthLayout>
      <Lazy>
        <Outlet />
      </Lazy>
    </AuthLayout>
  </AuthGuard>
);

const GuardedOutlet = () => (
  <AuthGuard>
    <Lazy>
      <Outlet />
    </Lazy>
  </AuthGuard>
);

/** Legacy /agents/* bookmarks → /harnesses/*. */
function LegacyAgentsRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={`${pathname.replace(/^\/agents/, '/harnesses')}${search}${hash}`} replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<App />}>
        <Route index element={<RootRedirect />} />
        <Route
          path="overview"
          element={
            <Lazy>
              <GlobalOverview />
            </Lazy>
          }
        />
        <Route
          path="messages"
          element={
            <Lazy>
              <MessageLog />
            </Lazy>
          }
        />
        <Route
          path="harnesses"
          element={
            <Lazy>
              <Workspace />
            </Lazy>
          }
        />
        <Route
          path="topology"
          element={
            <Lazy>
              <Topology />
            </Lazy>
          }
        />
        <Route
          path="playground"
          element={
            <Lazy>
              <Playground />
            </Lazy>
          }
        />
        <Route
          path="providers/subscriptions"
          element={
            <Lazy>
              <Subscriptions />
            </Lazy>
          }
        />
        <Route
          path="providers/usage-based"
          element={
            <Lazy>
              <Byok />
            </Lazy>
          }
        />
        <Route
          path="providers/local"
          element={
            <Lazy>
              <LocalProviders />
            </Lazy>
          }
        />
        <Route
          path="providers/connections/:connectionId"
          element={
            <Lazy>
              <ConnectionDetail />
            </Lazy>
          }
        />
        <Route
          path="integrations/mcp"
          element={
            <Lazy>
              <McpServer />
            </Lazy>
          }
        />
        <Route
          path="integrations/cli"
          element={
            <Lazy>
              <Cli />
            </Lazy>
          }
        />
        <Route path="harnesses/:agentName" element={<AgentGuard />}>
          {/* Redirects: /limits → /guardrails, /messages → global /messages */}
          <Route
            path="limits"
            element={
              <Lazy>
                <AgentLimitsRedirect />
              </Lazy>
            }
          />
          <Route
            path="messages"
            element={
              <Lazy>
                <AgentMessagesRedirect />
              </Lazy>
            }
          />
          {/* Tabbed shell (AgentDetail renders <Outlet />) */}
          <Route
            element={
              <Lazy>
                <AgentDetail />
              </Lazy>
            }
          >
            <Route
              index
              element={
                <Lazy>
                  <AgentOverview />
                </Lazy>
              }
            />
            <Route
              path="overview"
              element={
                <Lazy>
                  <AgentOverview />
                </Lazy>
              }
            />
            <Route
              path="routing"
              element={
                <Lazy>
                  <Routing />
                </Lazy>
              }
            />
            <Route
              path="models"
              element={
                <Lazy>
                  <AgentModels />
                </Lazy>
              }
            />
            <Route
              path="providers"
              element={
                <Lazy>
                  <AgentProviders />
                </Lazy>
              }
            />
            <Route
              path="guardrails"
              element={
                <Lazy>
                  <Limits />
                </Lazy>
              }
            />
            <Route
              path="settings/*"
              element={
                <Lazy>
                  <Settings />
                </Lazy>
              }
            />
          </Route>
          {/* Non-tab harness routes: kept reachable but not primary tabs */}
          <Route
            path="model-prices"
            element={
              <Lazy>
                <ModelPrices />
              </Lazy>
            }
          />
          <Route
            path="help"
            element={
              <Lazy>
                <Help />
              </Lazy>
            }
          />
        </Route>
        <Route path="agents/*" element={<LegacyAgentsRedirect />} />
        <Route path="agents" element={<LegacyAgentsRedirect />} />
        <Route
          path="connect-provider"
          element={
            <Lazy>
              <ConnectProvider />
            </Lazy>
          }
        />
        <Route
          path="account"
          element={
            <Lazy>
              <Account />
            </Lazy>
          }
        />
        <Route
          path="organization"
          element={
            <Lazy>
              <Organization />
            </Lazy>
          }
        />
        <Route
          path="triggers"
          element={
            <Lazy>
              <Triggers />
            </Lazy>
          }
        />
        <Route
          path="admin/users"
          element={
            <Lazy>
              <AdminUsers />
            </Lazy>
          }
        />
      </Route>
      <Route path="cli/auth" element={<GuardedOutlet />}>
        <Route index element={<CliAuth />} />
      </Route>
      <Route path="requests/:requestId" element={<GuardedOutlet />}>
        <Route index element={<RequestPage />} />
      </Route>
      <Route path="consent" element={<GuardedOutlet />}>
        <Route index element={<Consent />} />
      </Route>
      <Route
        path="oauth-error"
        element={
          <AuthLayout>
            <Lazy>
              <OauthError />
            </Lazy>
          </AuthLayout>
        }
      />
      <Route element={<GuestLayout />}>
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="reset-password" element={<ResetPassword />} />
      </Route>
      <Route
        path="setup"
        element={
          <AuthLayout>
            <Lazy>
              <Setup />
            </Lazy>
          </AuthLayout>
        }
      />
      <Route path="change-password" element={<ChangePasswordLayout />}>
        <Route index element={<ChangePassword />} />
      </Route>
      <Route path="welcome" element={<WelcomeLayout />}>
        <Route index element={<Welcome />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

/** Remounts the tree when the language changes, so every `t()` call re-reads. */
function Root() {
  const locale = useLocale();
  return (
    <BrowserRouter key={locale}>
      <title>Thinker</title>
      <ToastContainer />
      <AppRoutes />
    </BrowserRouter>
  );
}

// The static <title> in index.html stays for crawlers; React 19 hoists the
// <title> elements pages render, so drop the static one first.
document.head.querySelector('title')?.remove();

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
