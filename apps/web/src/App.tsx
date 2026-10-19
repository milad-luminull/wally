import { MutationRecovery } from '@/features/board/MutationRecovery';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { LoginPage } from '@/routes/LoginPage';
import { SignupPage } from '@/routes/SignupPage';
import { HomePage } from '@/routes/HomePage';
import { BoardEntryPage } from '@/routes/BoardEntryPage';
import { BoardPage } from '@/routes/BoardPage';
import { BoardsPage } from '@/routes/BoardsPage';
import { NotFoundPage } from '@/routes/NotFoundPage';
import { ShareRedeemPage } from '@/routes/ShareRedeemPage';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { OfflineBar } from '@/components/OfflineBar';

export function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <MutationRecovery />
        <OfflineBar />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/" element={<HomePage />} />
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <BoardEntryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boards"
            element={
              <ProtectedRoute>
                <BoardsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boards/:boardId"
            element={
              <ProtectedRoute>
                <BoardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/share/:token"
            element={
              <ProtectedRoute>
                <ShareRedeemPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
