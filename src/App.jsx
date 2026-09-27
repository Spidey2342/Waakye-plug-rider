import { useState, useEffect, useRef } from 'react';
import { AddRiderScreen } from './components/screens/AddRiderScreen';
import { LoginScreen } from './components/screens/LoginScreen';
import { HomeScreen } from './components/screens/HomeScreen';
import { ActiveOrderScreen } from './components/screens/ActiveOrderScreen';
import { EarningsScreen } from './components/screens/EarningsScreen';
import { SettleUpScreen } from './components/screens/SettleUpScreen';
import { OrderHistoryScreen } from './components/screens/OrderHistoryScreen';
import { ProfileScreen } from './components/screens/ProfileScreen';
import { ForgotPinScreen } from './components/screens/ForgotPinScreen';
import { isPastAccraCutoff, shouldLockForSettlement } from './lib/settlementLock';
import { fetchCommissionOwed } from './lib/earningsApi';
import { getCurrentRider } from './lib/riderAuth';
import { fetchActiveOrderForRider } from './lib/ordersApi';
import { submitRiderApplication } from './lib/submitRider';

function PlaceholderScreen({ title, onBack }) {
  return (
    <div className="min-h-[100dvh] bg-[#fefaf4] flex flex-col items-center justify-center px-6 text-center gap-4">
      <p className="text-lg font-bold">{title}</p>
      <p className="text-sm text-gray-500">This screen isn't built yet.</p>
      <button onClick={onBack} className="text-[#7a1d1d] font-bold text-sm">
        Back to Home
      </button>
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState('login');
  const [successMessage, setSuccessMessage] = useState(null);
  const [loggedInRider, setLoggedInRider] = useState(null);
  const [activeOrder, setActiveOrder] = useState(null);
  const [isLocked, setIsLocked] = useState(false);
  const [restoringSession, setRestoringSession] = useState(true);
  const [submitError, setSubmitError] = useState(null);

  // Last successful commission snapshot for this session. Used only when a
  // later lock check fails to fetch — see fail-open / fail-closed rule below.
  const lastKnownCommissionRef = useRef(null);

  async function checkSettlementLock(rider) {
    try {
      const { commissionOwed, lastSettledAt } = await fetchCommissionOwed(rider.id);
      lastKnownCommissionRef.current = { commissionOwed, lastSettledAt };
      if (shouldLockForSettlement(commissionOwed, lastSettledAt)) {
        setIsLocked(true);
        setScreen('settleUp');
      }
    } catch {
      const known = lastKnownCommissionRef.current;

      // After Accra noon, any failed fetch fails closed: an unknown or stale
      // snapshot must not let a rider bypass Settle Up during a network blip.
      // Settle Up re-fetches and can unlock if the rider actually owes 0.
      if (isPastAccraCutoff()) {
        setIsLocked(true);
        setScreen('settleUp');
        return;
      }

      // Before Accra noon, use the last successful snapshot when available;
      // with no snapshot, failing open is safe because the cutoff has not hit.
      if (known && shouldLockForSettlement(known.commissionOwed, known.lastSettledAt)) {
        setIsLocked(true);
        setScreen('settleUp');
      }
    }
  }

  // Puts the rider wherever they should actually be after logging in or
  // restoring a session: back into ActiveOrderScreen if they already have
  // an order in progress (rider_assigned/picked_up), otherwise Home. This
  // is what stops a page refresh mid-delivery from bouncing a rider back
  // to "Available Orders" while the DB still has them tied to their old
  // order — which previously surfaced as a raw
  // "duplicate key value violates unique constraint riders_one_active_order"
  // error the moment they tried to accept a new one.
  async function routeRiderToCurrentScreen(rider) {
    setLoggedInRider(rider);
    try {
      const inProgressOrder = await fetchActiveOrderForRider(rider.id);
      if (inProgressOrder) {
        setActiveOrder(inProgressOrder);
        setScreen('activeOrder');
        return;
      }
    } catch {
      // If we can't tell whether an order is in progress, fail toward the
      // Home screen rather than blocking the rider from logging in at all.
    }
    setScreen('home');
    await checkSettlementLock(rider);
  }

  // On every fresh page load, check whether a session already exists
  // before defaulting to the Login screen.
  useEffect(() => {
    (async () => {
      const rider = await getCurrentRider();
      if (rider) {
        await routeRiderToCurrentScreen(rider);
      }
      setRestoringSession(false);
    })();
  }, []);

  async function handleAddRider(formData) {
    setSubmitError(null);
    try {
      await submitRiderApplication(formData, { isSelfApply: false });
    } catch (err) {
      const errorMsg = `Failed to add rider: ${err.message || 'Unknown error'}`;
      setSubmitError(errorMsg);
      throw err;
    }

    setSuccessMessage(`${formData.full_name} was added successfully.`);
    setSubmitError(null);
    setScreen('success');
  }

  async function handleApply(formData) {
    setSubmitError(null);
    try {
      await submitRiderApplication(formData, { isSelfApply: true });
    } catch (err) {
      const errorMsg = `Could not submit application: ${err.message || 'Unknown error'}`;
      setSubmitError(errorMsg);
      throw err;
    }

    setSuccessMessage(`Thanks, ${formData.full_name}! We'll review your application and reach out soon.`);
    setSubmitError(null);
    setScreen('success');
  }

  if (restoringSession) {
    return <div className="min-h-[100dvh] bg-[#fefaf4]" />;
  }

  if (isLocked && loggedInRider) {
    return (
      <SettleUpScreen
        rider={loggedInRider}
        onSettled={() => {
          setIsLocked(false);
          setScreen('home');
        }}
      />
    );
  }

  if (screen === 'success') {
    return (
      <div className="min-h-[100dvh] bg-[#fefaf4] flex flex-col items-center justify-center px-6 text-center gap-4">
        <p className="text-lg font-bold">{successMessage}</p>
        <button
          onClick={() => { setScreen('addRider'); setSuccessMessage(null); }}
          className="bg-[#7a1d1d] text-white px-6 py-3 rounded-2xl font-bold"
        >
          Add Another Rider
        </button>
        <button onClick={() => setScreen('login')} className="text-[#7a1d1d] font-bold text-sm">
          Go to Login
        </button>
      </div>
    );
  }

  if (screen === 'addRider') {
    return (
      <AddRiderScreen
        onBack={() => { setScreen('login'); setSubmitError(null); }}
        onSubmit={handleAddRider}
        error={submitError}
        onErrorDismiss={() => setSubmitError(null)}
      />
    );
  }

  if (screen === 'apply') {
    return (
      <AddRiderScreen
        mode="apply"
        onBack={() => { setScreen('login'); setSubmitError(null); }}
        onSubmit={handleApply}
        error={submitError}
        onErrorDismiss={() => setSubmitError(null)}
      />
    );
  }

  if (screen === 'home') {
    return (
      <HomeScreen
        rider={loggedInRider}
        onNavigate={(tab) => {
          if (tab === 'home') return;
          setScreen(tab);
        }}
        onOrderAccepted={(order) => {
          setActiveOrder(order);
          setScreen('activeOrder');
        }}
      />
    );
  }

  if (screen === 'activeOrder') {
    return (
      <ActiveOrderScreen
        order={activeOrder}
        riderId={loggedInRider?.id}
        onBack={() => setScreen('home')}
        onDelivered={async () => {
          setActiveOrder(null);
          setScreen('home');
          await checkSettlementLock(loggedInRider);
        }}
      />
    );
  }

  if (screen === 'earnings') {
    return (
      <EarningsScreen
        rider={loggedInRider}
        onNavigate={(tab) => {
          if (tab === 'earnings') return;
          setScreen(tab);
        }}
      />
    );
  }

  if (screen === 'history') {
    return (
      <OrderHistoryScreen
        rider={loggedInRider}
        onNavigate={(tab) => {
          if (tab === 'history') return;
          setScreen(tab);
        }}
      />
    );
  }

  if (screen === 'profile') {
    return (
      <ProfileScreen
        rider={loggedInRider}
        onNavigate={(tab) => {
          if (tab === 'profile') return;
          setScreen(tab);
        }}
        onLoggedOut={() => {
          setLoggedInRider(null);
          setScreen('login');
        }}
      />
    );
  }

  if (screen === 'forgotPin') {
    return <ForgotPinScreen onBack={() => setScreen('login')} />;
  }

  return (
    <LoginScreen
      onSuccess={routeRiderToCurrentScreen}
      onForgotPin={() => setScreen('forgotPin')}
      onApply={() => setScreen('apply')}
    />
  );
}

export default App;