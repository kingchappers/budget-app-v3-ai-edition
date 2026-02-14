import { useAuth0 } from '@auth0/auth0-react';
import LoginButton from './LoginButton';
import { Profile } from './Profile';

function Authentication() {
  const { isAuthenticated, isLoading, error } = useAuth0();

  if (isLoading) {
    return (
      <div className="app-container">
        <div className="loading-state">
          <div className="loading-text">Loading...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-container">
        <div className="error-state">
          <div className="error-title">Oops!</div>
          <div className="error-message">Something went wrong</div>
          <div className="error-sub-message">{error.message}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="main-card-wrapper ">
      {isAuthenticated ? (
        <div className="logged-in-section">
          <div className="profile-card">
            <Profile />
          </div>
        </div>
      ) : (
        <div>
          <LoginButton />
        </div>
      )}
    </div>
  );
}

export default Authentication;