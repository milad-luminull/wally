import { MutationRecovery } from '@/features/board/MutationRecovery';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { LoginPage } from '@/routes/LoginPage';
import { SignupPage } from '@/routes/SignupPage';
import { LandingPage } from '@/routes/LandingPage';
import { BoardPage } from '@/routes/BoardPage';
import { NotFoundPage } from '@/routes/NotFoundPage';
import { ShareRedeemPage } from '@/routes/ShareRedeemPage';

export function App() {
  return (
    <BrowserRouter>
      <MutationRecovery />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <LandingPage />
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
    </BrowserRouter>
  );
}
