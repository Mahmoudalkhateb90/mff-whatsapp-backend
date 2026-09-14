import { Smartphone, LogOut } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { useNavigate, Link } from 'react-router-dom';

interface NavbarProps {
  userRole: string;
}

export default function Navbar({ userRole }: NavbarProps) {
  const navigate = useNavigate();
  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login');
  };

  return (
    <nav className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <div className="bg-emerald-500/10 p-1.5 rounded-lg border border-emerald-500/20">
                <Smartphone className="w-6 h-6 text-emerald-400" />
              </div>
              <span className="text-xl font-bold tracking-tight text-white">MFF WhatsApp</span>
            </Link>
          </div>

          <div className="flex items-center gap-6">
            {userRole === 'Super Admin' && (
              <Link 
                to="/admin/users" 
                className="text-sm font-semibold text-slate-400 hover:text-white transition-colors"
              >
                Admin Panel
              </Link>
            )}

            <div className="flex items-center gap-3 border-l border-slate-800 pl-6">
              <div className="flex flex-col items-end">
                <span className="text-sm font-semibold text-slate-200">
                  {auth.currentUser?.displayName || auth.currentUser?.email || 'User'}
                </span>
                <span className="text-xs font-medium text-emerald-400">{userRole}</span>
              </div>
              <button
                onClick={handleLogout}
                className="ml-2 p-2 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 rounded-lg transition-colors border border-transparent hover:border-rose-500/20"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
