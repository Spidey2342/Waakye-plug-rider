import { useState, useEffect } from 'react';
import { AddRiderScreen } from './components/screens/AddRiderScreen';
import { LoginScreen } from './components/screens/LoginScreen';
import { HomeScreen } from './components/screens/HomeScreen';
import { ActiveOrderScreen } from './components/screens/ActiveOrderScreen';
import { EarningsScreen } from './components/screens/EarningsScreen';
import { SettleUpScreen } from './components/screens/SettleUpScreen';
import { OrderHistoryScreen } from './components/screens/OrderHistoryScreen';
import { ProfileScreen } from './components/screens/ProfileScreen';
import { ForgotPinScreen } from './components/screens/ForgotPinScreen';
import { shouldLockForSettlement } from './lib/settlementLock';
import { fetchCommissionOwed } from './lib/earningsApi';
import { getCurrentRider } from './lib/riderAuth';

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

  async function checkSettlementLock(rider) {
    try {
      const { commissionOwed, lastSettledAt } = await fetchCommissionOwed(rider.id);
      if (shouldLockForSettlement(commissionOwed, lastSettledAt)) {
        setIsLocked(true);
        setScreen('settleUp');
      }
    } catch {
      // Fail open rather than fail closed on a network hiccup.
    }
  }

  // On every fresh page load, check whether a session already exists
  // before defaulting to the Login screen.
  useEffect(() => {
    (async () => {
      const rider = await getCurrentRider();
      if (rider) {
        setLoggedInRider(rider);
        setScreen('home');
        await checkSettlementLock(rider);
      }
      setRestoringSession(false);
    })();
  }, []);

  async function handleAddRider(formData) {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/add-rider`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          full_name: formData.full_name,
          phone: formData.phone,
          pin: formData.pin,
          photo_url: null,
          transport_type: formData.transport_type,
          ghana_card_number: formData.ghana_card_number,
          home_area: formData.home_area,
          emergency_contact_name: formData.emergency_contact_name,
          emergency_contact_phone: formData.emergency_contact_phone,
          deposit_amount: formData.deposit_amount || 0,
        }),
      }
    );

    const result = await res.json();

    if (!res.ok) {
      alert(`Failed to add rider: ${result.error || 'Unknown error'}`);
      throw new Error(result.error || 'Failed to add rider');
    }

    setSuccessMessage(`${formData.full_name} was added successfully.`);
    setScreen('success');
  }

  async function handleApply(formData) {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/add-rider`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          full_name: formData.full_name,
          phone: formData.phone,
          pin: formData.pin,
          photo_url: null,
          transport_type: formData.transport_type,
          ghana_card_number: formData.ghana_card_number,
          home_area: formData.home_area,
          emergency_contact_name: formData.emergency_contact_name,
          emergency_contact_phone: formData.emergency_contact_phone,
          is_self_apply: true,
        }),
      }
    );

    const result = await res.json();

    if (!res.ok) {
      alert(`Could not submit application: ${result.error || 'Unknown error'}`);
      throw new Error(result.error || 'Could not submit application');
    }

    setSuccessMessage(`Thanks, ${formData.full_name}! We'll review your application and reach out soon.`);
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
    return <AddRiderScreen onBack={() => setScreen('login')} onSubmit={handleAddRider} />;
  }

  if (screen === 'apply') {
    return <AddRiderScreen mode="apply" onBack={() => setScreen('login')} onSubmit={handleApply} />;
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
      onSuccess={async (rider) => {
        setLoggedInRider(rider);
        setScreen('home');
        await checkSettlementLock(rider);
      }}
      onForgotPin={() => setScreen('forgotPin')}
      onApply={() => setScreen('apply')}
    />
  );
}

export default App;