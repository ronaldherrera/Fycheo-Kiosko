import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Clock, LogOut, CheckCircle2, AlertCircle, Loader2, Fingerprint } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';

const LETTERS_ROWS = [
  ['A', 'B', 'C', 'D', 'E', 'F'],
  ['G', 'H', 'I', 'J', 'K', 'L'],
  ['M', 'N', 'Ñ', 'O', 'P', 'Q'],
  ['R', 'S', 'T', 'U', 'V', 'W'],
  ['X', 'Y', 'Z']
];

export default function KioskModeScreen() {
  const { companyId } = useParams();
  const navigate = useNavigate();
  
  const [currentTime, setCurrentTime] = useState(new Date());
  const [dni, setDni] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Exit PIN Modal State
  const [showExitModal, setShowExitModal] = useState(false);
  const [exitPin, setExitPin] = useState('');
  const [exitError, setExitError] = useState(false);
  
  // Modal State
  const [employee, setEmployee] = useState<any>(null);
  const [successMessage, setSuccessMessage] = useState<{type: string, time: string} | null>(null);
  const [lastEntryType, setLastEntryType] = useState<string | null>(null);
  const [todayEntries, setTodayEntries] = useState<any[]>([]);
  const [monthEntries, setMonthEntries] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'calendar' | 'hours' | 'absences'>('dashboard');
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [companyInfo, setCompanyInfo] = useState<{name: string, logo_url: string | null} | null>(null);

  // Funcionalidad extra
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [absenceType, setAbsenceType] = useState<string>('vacation');
  const [absenceStartDate, setAbsenceStartDate] = useState<string>('');
  const [absenceEndDate, setAbsenceEndDate] = useState<string>('');
  const [absenceSubmitting, setAbsenceSubmitting] = useState(false);
  const [absenceSuccessMsg, setAbsenceSuccessMsg] = useState(false);
  const [logoutCountdown, setLogoutCountdown] = useState(30);

  useEffect(() => {
    if (companyId) {
      const fetchCompany = async () => {
        const { data } = await supabase
          .from('companies')
          .select('name, logo_url')
          .eq('id', companyId)
          .single();
        if (data) {
          setCompanyInfo(data);
        }
      };
      fetchCompany();
    }
  }, [companyId]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Auto-logout por inactividad (30s)
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    let intervalId: ReturnType<typeof setInterval>;

    const resetTimer = () => {
      if (employee && !successMessage) {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        setLogoutCountdown(30);
        
        intervalId = setInterval(() => {
          setLogoutCountdown(prev => {
            if (prev <= 1) {
              clearInterval(intervalId);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);

        timeoutId = setTimeout(() => {
          setEmployee(null);
          setDni('');
          setTodayEntries([]);
          setMonthEntries([]);
          setActiveTab('dashboard');
        }, 30000); // 30 seconds
      }
    };

    if (employee && !successMessage) {
      resetTimer();
      window.addEventListener('mousemove', resetTimer);
      window.addEventListener('mousedown', resetTimer);
      window.addEventListener('keypress', resetTimer);
      window.addEventListener('touchstart', resetTimer);
    }

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('mousedown', resetTimer);
      window.removeEventListener('keypress', resetTimer);
      window.removeEventListener('touchstart', resetTimer);
    };
  }, [employee, successMessage]);

  // Timer para "Tiempo en este estado"
  useEffect(() => {
    if (!employee || todayEntries.length === 0) {
      setElapsedTime(0);
      return;
    }

    const lastEntry = todayEntries[0];
    const startTimestamp = new Date(lastEntry.timestamp).getTime();
    
    const updateTimer = () => {
      const now = new Date().getTime();
      setElapsedTime(Math.floor((now - startTimestamp) / 1000));
    };

    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [employee, todayEntries]);

  const calculateTotalHours = () => {
    if (!monthEntries || monthEntries.length === 0) return 0;
    let totalSeconds = 0;
    const chronological = [...monthEntries].reverse();
    let currentInTime: number | null = null;
    
    for (const entry of chronological) {
      const ts = new Date(entry.timestamp).getTime();
      if (entry.type === 'clock_in') {
        currentInTime = ts;
      } else if (entry.type === 'clock_out') {
        if (currentInTime) {
          totalSeconds += (ts - currentInTime) / 1000;
          currentInTime = null;
        }
      } else if (entry.type === 'break-start' || entry.type === 'break_start') {
        if (currentInTime) {
          totalSeconds += (ts - currentInTime) / 1000;
          currentInTime = null;
        }
      } else if (entry.type === 'break-end' || entry.type === 'break_end') {
        currentInTime = ts;
      }
    }
    
    if (currentInTime && (lastEntryType === 'clock_in' || lastEntryType === 'break-end' || lastEntryType === 'break_end' || lastEntryType === 'permission-end' || lastEntryType === 'permission_end')) {
      totalSeconds += (new Date().getTime() - currentInTime) / 1000;
    }
    
    return totalSeconds / 3600;
  };
  const workedHours = calculateTotalHours();
  const workedPercentage = Math.min(100, Math.max(0, (workedHours / 160) * 100));

  const handleAbsenceSubmit = async () => {
    if (!absenceStartDate || !absenceEndDate) {
      setError("Por favor, selecciona las fechas");
      setTimeout(() => setError(null), 3000);
      return;
    }
    setAbsenceSubmitting(true);
    try {
      const { error } = await supabase.from('absences').insert({
        employee_id: employee.userId,
        company_id: companyId,
        type: absenceType,
        start_date: absenceStartDate,
        end_date: absenceEndDate,
        status: 'pending',
      });
      if (error) throw error;
      setAbsenceSuccessMsg(true);
      setTimeout(() => {
        setAbsenceSuccessMsg(false);
        setAbsenceStartDate('');
        setAbsenceEndDate('');
        setActiveTab('dashboard');
      }, 3000);
    } catch (err: any) {
      setError(err.message || 'Error al solicitar ausencia');
      setTimeout(() => setError(null), 3000);
    } finally {
      setAbsenceSubmitting(false);
    }
  };

  const formatElapsed = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleKeyPress = (key: string) => {
    if (dni.length < 15) {
      setDni(prev => prev + key);
      setError(null);
    }
  };

  const handleDelete = () => {
    setDni(prev => prev.slice(0, -1));
    setError(null);
  };

  const handleClear = () => {
    setDni('');
    setError(null);
  };

  const handleValidate = async () => {
    if (dni.length < 5) {
      setError('Por favor, introduce un DNI/NIE válido');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Verificar si este dispositivo sigue siendo el kiosko activo
      const localDeviceId = localStorage.getItem('kiosk_device_id');
      const { data: companyData, error: companyError } = await supabase
        .from('companies')
        .select('kiosk_device_id')
        .eq('id', companyId)
        .single();
        
      if (companyError) throw companyError;
      
      if (companyData.kiosk_device_id && companyData.kiosk_device_id !== localDeviceId) {
        setError("⚠️ Este dispositivo ha sido desvinculado. Se ha activado otra tablet como Kiosko.");
        setTimeout(() => {
          navigate('/setup');
        }, 5000);
        return;
      }

      // 2. Buscar al empleado por DNI en esta empresa
      // Supabase query using a join with company_members
      const { data, error } = await supabase
        .from('company_members')
        .select(`
          user_id,
          profiles!inner(
            full_name,
            avatar,
            dni_nie
          )
        `)
        .eq('company_id', companyId)
        .ilike('profiles.dni_nie', dni.trim())
        .single();

      if (error || !data) {
        throw new Error('Empleado no encontrado o no pertenece a esta empresa');
      }

      const profiles: any = data.profiles;
      
      // 3. Obtener todos los fichajes del empleado del mes actual
      const nowTime = new Date();
      const startOfM = startOfMonth(nowTime);

      const { data: entries, error: entriesError } = await supabase
        .from('time_entries')
        .select('*')
        .eq('user_id', data.user_id)
        .gte('timestamp', startOfM.toISOString())
        .order('timestamp', { ascending: false });

      if (!entriesError && entries) {
        setMonthEntries(entries);
        
        // Filter for today
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const tEntries = entries.filter(e => new Date(e.timestamp) >= startOfDay);
        
        setTodayEntries(tEntries);
        if (tEntries.length > 0) {
          setLastEntryType(tEntries[0].type);
        } else {
          setLastEntryType(null);
        }
      }

      setEmployee({
        userId: data.user_id,
        name: profiles.full_name,
        avatar: profiles.avatar,
        dni: profiles.dni_nie
      });

    } catch (err: any) {
      setError(err.message || 'Error al validar el DNI');
    } finally {
      setLoading(false);
    }
  };

  const handleClockAction = async (type: string) => {
    if (!employee || !companyId) return;
    setLoading(true);
    
    try {
      const now = new Date();
      const localTime = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      const { error } = await supabase
        .from('time_entries')
        .insert({
          user_id: employee.userId,
          company_id: companyId,
          type: type,
          timestamp: now.toISOString(),
          is_manual: false,
          status: 'approved' // Automatically approved because it's real time via Kiosk
        });

      if (error) throw error;

      // Show success modal
      setSuccessMessage({ type: type, time: localTime });
      
      // Reset after 3 seconds
      setTimeout(() => {
        setSuccessMessage(null);
        setEmployee(null);
        setDni('');
      }, 3000);

    } catch (err: any) {
      setError('Error al registrar el fichaje. Inténtalo de nuevo.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex text-slate-100 overflow-hidden">
      {/* Left Sidebar - Clock and Info */}
      {(!employee && !successMessage) && (
        <div className="w-1/3 bg-slate-800 p-10 flex flex-col justify-between border-r border-slate-700 shadow-2xl z-10 relative overflow-hidden animate-in slide-in-from-left duration-500">
          {/* Decoración de fondo */}
          <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none"></div>
          <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>

          <div>
            <div className="flex items-center gap-3 mb-16">
              <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
                <Clock className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold tracking-tight text-white">Fycheo Kiosko</span>
            </div>

            <div className="space-y-2">
              <h2 className="text-[5rem] font-black leading-none tracking-tighter text-white tabular-nums drop-shadow-md">
                {format(currentTime, 'HH:mm')}
              </h2>
              <p className="text-2xl font-medium text-slate-400 capitalize">
                {format(currentTime, "EEEE, d 'de' MMMM", { locale: es })}
              </p>
            </div>
          </div>

          {/* Company Info */}
          <div className="flex-1 flex flex-col justify-center">
            {companyInfo && (
              <div className="animate-in fade-in slide-in-from-left-4 duration-700">
                {companyInfo.logo_url ? (
                  <div className="h-24 max-w-[240px] mb-6 flex items-center justify-start">
                    <img src={companyInfo.logo_url} alt={companyInfo.name} className="max-h-full max-w-full object-contain drop-shadow-xl" />
                  </div>
                ) : (
                  <div className="w-16 h-16 bg-slate-700/50 rounded-2xl flex items-center justify-center mb-6 shadow-lg border border-slate-600/50">
                    <span className="material-symbols-outlined text-[32px] text-slate-400">domain</span>
                  </div>
                )}
                <h3 className="text-3xl font-black text-white tracking-tight leading-tight">{companyInfo.name}</h3>
                <p className="text-primary font-medium mt-2 tracking-wide uppercase text-sm">Organización Vinculada</p>
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div>
            <p className="text-sm text-slate-500 mb-4">Introduce tu DNI/NIE para acceder a tus opciones de fichaje.</p>
            <button 
              onClick={() => setShowExitModal(true)}
              className="flex items-center gap-2 text-slate-500 hover:text-white transition-colors text-sm font-bold bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg"
            >
              <LogOut className="w-4 h-4" />
              Salir del Kiosko
            </button>
          </div>
        </div>
      )}

      {/* Right Area - Interaction */}
      <div className="flex-1 flex flex-col items-center justify-center p-12 relative">
        
        {/* Main Interface */}
        {!employee && !successMessage && (
          <div className="w-full max-w-4xl bg-slate-800 rounded-[2.5rem] p-8 shadow-2xl border border-slate-700/50">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-600">
                <Fingerprint className="w-8 h-8 text-primary" />
              </div>
              <h1 className="text-3xl font-bold text-white">Identificación</h1>
            </div>

            {/* DNI Display */}
            <div className="mb-8">
              <div className={`w-full max-w-2xl mx-auto h-20 bg-slate-900 border-2 rounded-2xl flex items-center justify-center text-4xl font-mono tracking-[0.5em] transition-all ${error ? 'border-red-500/50 text-red-400' : dni ? 'border-primary/50 text-white shadow-[0_0_20px_rgba(59,130,246,0.15)]' : 'border-slate-700 text-slate-500'}`}>
                {dni || 'DNI/NIE'}
                {dni && <span className="w-[3px] h-10 bg-primary ml-1 animate-pulse rounded-full"></span>}
              </div>
              {error && (
                <p className="text-red-400 text-center mt-3 font-medium flex items-center justify-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  {error}
                </p>
              )}
            </div>

            {/* Virtual Keyboard: Numpad + Letters */}
            <div className="flex gap-8 items-stretch bg-slate-900/50 p-6 rounded-3xl border border-slate-700/50">
              
              {/* Numpad (Left) */}
              <div className="w-80 grid grid-cols-3 gap-3 shrink-0">
                {['1','2','3','4','5','6','7','8','9'].map(num => (
                  <button
                    key={num}
                    onClick={() => handleKeyPress(num)}
                    className="h-20 bg-slate-700 hover:bg-slate-600 active:bg-primary active:scale-95 rounded-2xl text-4xl font-bold text-white shadow-md border border-slate-600 transition-all flex items-center justify-center"
                  >
                    {num}
                  </button>
                ))}
                <button
                  onClick={() => handleKeyPress('0')}
                  className="col-start-2 h-20 bg-slate-700 hover:bg-slate-600 active:bg-primary active:scale-95 rounded-2xl text-4xl font-bold text-white shadow-md border border-slate-600 transition-all flex items-center justify-center"
                >
                  0
                </button>
              </div>

              {/* Divider */}
              <div className="w-px bg-slate-700 mx-2"></div>

              {/* Letters (Right) */}
              <div className="flex-1 flex flex-col gap-3">
                {LETTERS_ROWS.map((row, rowIndex) => (
                  <div key={rowIndex} className="flex justify-center gap-2 flex-1">
                    {row.map(l => (
                      <button
                        key={l}
                        onClick={() => handleKeyPress(l)}
                        className="w-12 h-full bg-slate-700/50 hover:bg-slate-600 active:bg-primary active:scale-95 rounded-xl text-xl font-bold text-slate-200 border border-slate-600/50 shadow-sm transition-all flex items-center justify-center"
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                ))}
              </div>

            </div>
            
            {/* Bottom Actions */}
            <div className="flex justify-between items-center mt-8 gap-4">
              <div className="flex gap-4">
                <button
                  onClick={handleClear}
                  className="px-8 py-5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-2xl text-lg font-bold text-slate-400 shadow-md transition-all border border-slate-700 hover:border-slate-600 uppercase"
                >
                  Limpiar
                </button>
                <button
                  onClick={handleDelete}
                  className="px-8 py-5 bg-slate-800 hover:bg-slate-700 active:bg-red-500 active:text-white rounded-2xl text-lg font-bold text-slate-400 shadow-md transition-all border border-slate-700 hover:border-slate-600 uppercase"
                >
                  Borrar
                </button>
              </div>
              <button
                onClick={handleValidate}
                disabled={loading || dni.length === 0}
                className="flex-1 max-w-sm bg-primary hover:bg-primary/90 disabled:bg-primary/30 disabled:text-white/50 active:scale-95 rounded-2xl text-xl font-bold text-white shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-3 py-5"
              >
                {loading ? <Loader2 className="w-8 h-8 animate-spin" /> : 'Validar Identidad'}
              </button>
            </div>

          </div>
        )}

        {/* Portal Dashboard */}
        {employee && !successMessage && (
          <div className="w-full max-w-6xl h-[85vh] bg-slate-900 rounded-[3rem] p-0 shadow-2xl border border-slate-700/50 animate-in fade-in zoom-in duration-300 flex overflow-hidden">
            
            {/* Sidebar Menú */}
            <div className="w-72 bg-slate-800 flex flex-col border-r border-slate-700/50 z-10 shrink-0">
              <div className="p-8 flex flex-col items-center border-b border-slate-700/50">
                <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-slate-600 bg-slate-700 shadow-md mb-4">
                  {employee.avatar ? (
                    <img src={employee.avatar} alt={employee.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-3xl font-bold text-slate-400">
                      {employee.name.charAt(0)}
                    </div>
                  )}
                </div>
                <h2 className="text-xl font-bold text-white text-center leading-tight mb-1">{employee.name}</h2>
                <p className="text-slate-400 font-mono text-xs">{employee.dni}</p>
              </div>

              <div className="flex-1 p-6 flex flex-col gap-3 overflow-y-auto custom-scrollbar">
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className={`flex items-center gap-4 px-5 py-4 rounded-2xl font-bold transition-all ${activeTab === 'dashboard' ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-slate-400 hover:bg-slate-700 hover:text-white'}`}
                >
                  <span className="material-symbols-outlined text-[24px]">timer</span>
                  Fichar
                </button>
                <button
                  onClick={() => setActiveTab('calendar')}
                  className={`flex items-center gap-4 px-5 py-4 rounded-2xl font-bold transition-all ${activeTab === 'calendar' ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-slate-400 hover:bg-slate-700 hover:text-white'}`}
                >
                  <span className="material-symbols-outlined text-[24px]">calendar_month</span>
                  Calendario
                </button>
                <button
                  onClick={() => setActiveTab('hours')}
                  className={`flex items-center gap-4 px-5 py-4 rounded-2xl font-bold transition-all ${activeTab === 'hours' ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-slate-400 hover:bg-slate-700 hover:text-white'}`}
                >
                  <span className="material-symbols-outlined text-[24px]">query_stats</span>
                  Mis Horas
                </button>
                <button
                  onClick={() => setActiveTab('absences')}
                  className={`flex items-center gap-4 px-5 py-4 rounded-2xl font-bold transition-all ${activeTab === 'absences' ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-slate-400 hover:bg-slate-700 hover:text-white'}`}
                >
                  <span className="material-symbols-outlined text-[24px]">flight_takeoff</span>
                  Ausencias
                </button>
              </div>

              <div className="p-6 border-t border-slate-700/50">
                <button 
                  onClick={() => { setEmployee(null); setTodayEntries([]); setMonthEntries([]); setActiveTab('dashboard'); }} 
                  className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-slate-900 hover:bg-red-500/10 text-slate-400 hover:text-red-400 rounded-2xl font-bold transition-colors border border-slate-700 hover:border-red-500/30"
                >
                  <span className="material-symbols-outlined text-[24px]">logout</span>
                  Cerrar Sesión
                </button>
                <p className="text-center text-xs text-slate-600 mt-4">Autocierre en <span className="text-slate-400 font-bold">{logoutCountdown}s</span></p>
              </div>
            </div>

            {/* Contenido Principal */}
            <div className="flex-1 bg-slate-900 flex flex-col overflow-hidden relative">
              
              {/* TAB: FICHAR */}
              {activeTab === 'dashboard' && (
                <div className="flex-1 p-10 overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col items-center">
                  <div className="w-full max-w-2xl bg-slate-800 rounded-[2rem] p-8 flex flex-col items-center justify-center border border-slate-700/50 shadow-inner mb-8">
                    <p className="text-slate-400 font-medium mb-2 tracking-wide">Tiempo en este estado</p>
                    <div className="text-[5rem] leading-none font-black text-white tabular-nums tracking-tighter">
                      {formatElapsed(elapsedTime)}
                    </div>
                    <div className="mt-4 px-6 py-2 bg-slate-900/50 rounded-full border border-slate-700">
                      <span className="text-sm font-bold uppercase tracking-widest text-slate-300">
                        {lastEntryType === 'clock_in' || lastEntryType === 'break-end' || lastEntryType === 'break_end' || lastEntryType === 'permission-end' || lastEntryType === 'permission_end' 
                          ? <span className="text-blue-400">Trabajando</span>
                          : lastEntryType === 'break-start' || lastEntryType === 'break_start' 
                          ? <span className="text-amber-400">En Descanso</span>
                          : lastEntryType === 'permission-start' || lastEntryType === 'permission_start' 
                          ? <span className="text-fuchsia-400">Con Permiso</span>
                          : <span className="text-slate-500">Fuera</span>
                        }
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 w-full max-w-2xl">
                    <button
                      onClick={() => handleClockAction('clock_in')}
                      disabled={loading}
                      className="group relative flex flex-col items-center justify-center gap-3 p-6 bg-blue-600 hover:bg-blue-500 rounded-3xl transition-all disabled:opacity-50 shadow-lg shadow-blue-900/20"
                    >
                      <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                         <span className="material-symbols-outlined text-[32px] text-white">login</span>
                      </div>
                      <span className="text-xl font-bold text-white tracking-wide uppercase">Entrada</span>
                    </button>

                    <button
                      onClick={() => handleClockAction('clock_out')}
                      disabled={loading}
                      className="group relative flex flex-col items-center justify-center gap-3 p-6 bg-slate-700 hover:bg-slate-600 rounded-3xl transition-all disabled:opacity-50 shadow-lg shadow-slate-900/20"
                    >
                      <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                         <span className="material-symbols-outlined text-[32px] text-white">logout</span>
                      </div>
                      <span className="text-xl font-bold text-white tracking-wide uppercase">Salida</span>
                    </button>

                    <button
                      onClick={() => handleClockAction(lastEntryType === 'break-start' || lastEntryType === 'break_start' ? 'break-end' : 'break-start')}
                      disabled={loading}
                      className={`group relative flex flex-col items-center justify-center gap-3 p-6 rounded-3xl transition-all disabled:opacity-50 shadow-lg shadow-amber-900/20 ${lastEntryType === 'break-start' || lastEntryType === 'break_start' ? 'bg-slate-700 hover:bg-slate-600 border border-amber-500/50' : 'bg-amber-600 hover:bg-amber-500'}`}
                    >
                      <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                         <span className="material-symbols-outlined text-[32px] text-white">coffee</span>
                      </div>
                      <span className={`text-xl font-bold tracking-wide uppercase ${lastEntryType === 'break-start' || lastEntryType === 'break_start' ? 'text-amber-500' : 'text-white'}`}>
                        {lastEntryType === 'break-start' || lastEntryType === 'break_start' ? 'Fin Descanso' : 'Descanso'}
                      </span>
                    </button>

                    <button
                      onClick={() => handleClockAction(lastEntryType === 'permission-start' || lastEntryType === 'permission_start' ? 'permission-end' : 'permission-start')}
                      disabled={loading}
                      className={`group relative flex flex-col items-center justify-center gap-3 p-6 rounded-3xl transition-all disabled:opacity-50 shadow-lg shadow-fuchsia-900/20 ${lastEntryType === 'permission-start' || lastEntryType === 'permission_start' ? 'bg-slate-700 hover:bg-slate-600 border border-fuchsia-500/50' : 'bg-fuchsia-700 hover:bg-fuchsia-600'}`}
                    >
                      <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                         <span className="material-symbols-outlined text-[32px] text-white">edit_note</span>
                      </div>
                      <span className={`text-xl font-bold tracking-wide uppercase ${lastEntryType === 'permission-start' || lastEntryType === 'permission_start' ? 'text-fuchsia-500' : 'text-white'}`}>
                        {lastEntryType === 'permission-start' || lastEntryType === 'permission_start' ? 'Fin Permiso' : 'Permiso'}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* TAB: CALENDARIO */}
              {activeTab === 'calendar' && (
                <div className="flex-1 p-10 overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-bottom-4 duration-500 flex gap-8">
                  <div className="flex-1 bg-slate-800 rounded-[2rem] p-8 border border-slate-700/50">
                    <h3 className="text-2xl font-bold text-white mb-6">Fichajes del Mes</h3>
                    <div className="grid grid-cols-7 gap-4 mb-4">
                      {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => (
                        <div key={day} className="text-center font-bold text-slate-500 uppercase tracking-wider text-sm">{day}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-4">
                      {(() => {
                        const now = new Date();
                        const start = startOfMonth(now);
                        const end = endOfMonth(now);
                        const days = eachDayOfInterval({ start, end });
                        
                        const startDayOfWeek = start.getDay(); // 0 is Sunday
                        const offset = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;
                        
                        const blanks = Array.from({ length: offset }).map((_, i) => (
                          <div key={`blank-${i}`} className="aspect-square rounded-2xl bg-slate-900/30"></div>
                        ));
                        
                        const dayCells = days.map((day, i) => {
                          const isToday = isSameDay(day, now);
                          const hasEntries = monthEntries.some(e => isSameDay(new Date(e.timestamp), day));
                          const isSelected = selectedDate && isSameDay(day, selectedDate);
                          
                          return (
                            <button 
                              key={`day-${i}`} 
                              onClick={() => setSelectedDate(day)}
                              className={`aspect-square rounded-2xl flex flex-col items-center justify-center relative transition-all active:scale-95 ${
                                isSelected ? 'bg-primary border-2 border-primary shadow-lg shadow-primary/30' :
                                isToday ? 'bg-primary/20 border-2 border-primary hover:bg-primary/30' : 
                                hasEntries ? 'bg-slate-700 hover:bg-slate-600' : 'bg-slate-800 border border-slate-700 hover:border-slate-600'
                              } `}
                            >
                              <span className={`text-lg font-bold ${isSelected ? 'text-white' : isToday ? 'text-primary' : hasEntries ? 'text-white' : 'text-slate-500'}`}>{format(day, 'd')}</span>
                              {hasEntries && <div className={`w-2 h-2 rounded-full mt-1 ${isSelected ? 'bg-white' : 'bg-emerald-500'}`}></div>}
                            </button>
                          );
                        });
                        
                        return [...blanks, ...dayCells];
                      })()}
                    </div>
                  </div>

                  {/* Panel Detalle Diario */}
                  <div className="w-80 bg-slate-800 rounded-[2rem] p-6 border border-slate-700/50 flex flex-col">
                    <h3 className="text-xl font-bold text-white mb-6 border-b border-slate-700/50 pb-4">
                      {selectedDate ? format(selectedDate, "d 'de' MMMM", { locale: es }) : 'Selecciona un día'}
                    </h3>
                    
                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 flex flex-col gap-3">
                      {!selectedDate ? (
                         <div className="flex flex-col items-center justify-center text-center text-slate-500 h-full opacity-50">
                            <span className="material-symbols-outlined text-[48px] mb-2">touch_app</span>
                            <p>Toca un día en el calendario para ver tus movimientos.</p>
                         </div>
                      ) : (
                         (() => {
                           const dayEntries = monthEntries.filter(e => isSameDay(new Date(e.timestamp), selectedDate));
                           if (dayEntries.length === 0) {
                             return <div className="text-center p-6 bg-slate-900/50 rounded-2xl text-slate-500 font-medium">Sin fichajes en este día</div>;
                           }
                           
                           // Sort chronological for display (monthEntries is desc)
                           return [...dayEntries].reverse().map((entry, idx) => (
                             <div key={idx} className="flex items-center gap-4 bg-slate-900 p-4 rounded-2xl">
                               <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                  entry.type === 'clock_in' || entry.type === 'break-end' || entry.type === 'permission-end' || entry.type === 'break_end' || entry.type === 'permission_end' ? 'bg-blue-500/20 text-blue-400' :
                                  entry.type === 'clock_out' ? 'bg-slate-700 text-slate-400' :
                                  entry.type.includes('break') ? 'bg-amber-500/20 text-amber-400' : 'bg-fuchsia-500/20 text-fuchsia-400'
                               }`}>
                                 <span className="material-symbols-outlined text-[20px]">
                                   {entry.type === 'clock_in' || entry.type === 'break-end' || entry.type === 'permission-end' || entry.type === 'break_end' || entry.type === 'permission_end' ? 'login' :
                                    entry.type === 'clock_out' ? 'logout' :
                                    entry.type.includes('break') ? 'coffee' : 'edit_note'}
                                 </span>
                               </div>
                               <div>
                                 <p className="font-bold text-slate-200 capitalize text-sm">
                                   {entry.type === 'clock_in' ? 'Entrada' : 
                                    entry.type === 'clock_out' ? 'Salida' :
                                    entry.type === 'break-start' || entry.type === 'break_start' ? 'Descanso' :
                                    entry.type === 'break-end' || entry.type === 'break_end' ? 'Fin Desc.' :
                                    entry.type === 'permission-start' || entry.type === 'permission_start' ? 'Permiso' :
                                    'Fin Permiso'}
                                 </p>
                                 <p className="text-xs font-bold text-slate-400">
                                   {format(new Date(entry.timestamp), 'HH:mm')}
                                 </p>
                               </div>
                             </div>
                           ));
                         })()
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: MIS HORAS */}
              {activeTab === 'hours' && (
                <div className="flex-1 p-10 overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col items-center">
                  <h3 className="text-3xl font-bold text-white mb-2 self-start">Mis Horas</h3>
                  <p className="text-slate-400 mb-8 self-start">Balance de horas trabajadas en {format(new Date(), 'MMMM', { locale: es })}</p>
                  
                  <div className="w-full max-w-2xl bg-slate-800 rounded-[3rem] p-12 border border-slate-700/50 flex flex-col items-center justify-center shadow-xl">
                    <div className="relative w-64 h-64 mb-8">
                      {/* Círculo de Progreso */}
                      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="8" className="text-slate-700" />
                        <circle 
                          cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="8" 
                          strokeDasharray={`${workedPercentage * 2.827} 282.7`} 
                          strokeLinecap="round" 
                          className="text-primary transition-all duration-1000 ease-out" 
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-5xl font-black text-white tabular-nums tracking-tighter">
                          {Math.floor(workedHours)}<span className="text-2xl text-slate-400 font-bold">h</span>
                        </span>
                        <span className="text-slate-400 font-medium">
                          {Math.floor((workedHours % 1) * 60)}m
                        </span>
                      </div>
                    </div>
                    
                    <h4 className="text-2xl font-bold text-white mb-2">Acumulado Mensual</h4>
                    <p className="text-slate-400 text-center max-w-sm mb-6">
                      Has acumulado este tiempo de trabajo efectivo (descontando descansos) frente a una estimación base de 160h.
                    </p>

                    <div className="w-full bg-slate-900 rounded-2xl p-4 flex justify-between items-center px-8 border border-slate-700/50">
                       <div className="text-center">
                          <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">Fichajes</p>
                          <p className="text-white text-xl font-bold">{monthEntries.length}</p>
                       </div>
                       <div className="w-px h-8 bg-slate-700"></div>
                       <div className="text-center">
                          <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">Porcentaje</p>
                          <p className="text-white text-xl font-bold">{Math.round(workedPercentage)}%</p>
                       </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: AUSENCIAS */}
              {activeTab === 'absences' && (
                <div className="flex-1 p-10 overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-bottom-4 duration-500 flex justify-center">
                  <div className="w-full max-w-2xl">
                    <h3 className="text-3xl font-bold text-white mb-2">Solicitar Ausencia</h3>
                    <p className="text-slate-400 mb-8">Rellena el formulario para pedir tiempo libre</p>

                    {absenceSuccessMsg ? (
                      <div className="bg-emerald-500/10 border border-emerald-500/50 rounded-[2rem] p-12 flex flex-col items-center text-center animate-in zoom-in duration-300">
                        <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center mb-6">
                           <span className="material-symbols-outlined text-white text-[40px]">check</span>
                        </div>
                        <h4 className="text-2xl font-bold text-emerald-400 mb-2">¡Solicitud Enviada!</h4>
                        <p className="text-emerald-500/80">Tu responsable la revisará pronto.</p>
                      </div>
                    ) : (
                      <div className="bg-slate-800 rounded-[2rem] p-8 border border-slate-700/50 shadow-xl">
                        
                        {/* Tipo de Ausencia */}
                        <div className="mb-8">
                          <label className="block text-slate-400 font-bold mb-4 uppercase tracking-wider text-sm">Tipo de Ausencia</label>
                          <div className="grid grid-cols-3 gap-4">
                            {[
                              { id: 'vacation', label: 'Vacaciones', icon: 'beach_access' },
                              { id: 'manual_paid', label: 'Enfermedad', icon: 'medical_services' },
                              { id: 'manual_unpaid', label: 'Asuntos Propios', icon: 'event_busy' }
                            ].map(t => (
                              <button
                                key={t.id}
                                onClick={() => setAbsenceType(t.id)}
                                className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all active:scale-95 ${absenceType === t.id ? 'border-primary bg-primary/10 text-primary' : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-600'}`}
                              >
                                <span className="material-symbols-outlined text-[32px]">{t.icon}</span>
                                <span className="font-bold text-sm text-center leading-tight">{t.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Fechas */}
                        <div className="grid grid-cols-2 gap-6 mb-8">
                          <div>
                            <label className="block text-slate-400 font-bold mb-3 uppercase tracking-wider text-sm">Fecha Inicio</label>
                            <input 
                              type="date" 
                              value={absenceStartDate}
                              onChange={(e) => setAbsenceStartDate(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-4 text-white font-medium focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-slate-400 font-bold mb-3 uppercase tracking-wider text-sm">Fecha Fin</label>
                            <input 
                              type="date" 
                              value={absenceEndDate}
                              onChange={(e) => setAbsenceEndDate(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-4 text-white font-medium focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                            />
                          </div>
                        </div>

                        {error && (
                          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-3 text-red-400 font-medium">
                            <span className="material-symbols-outlined">error</span>
                            {error}
                          </div>
                        )}

                        {/* Submit */}
                        <button
                          onClick={handleAbsenceSubmit}
                          disabled={absenceSubmitting || !absenceStartDate || !absenceEndDate}
                          className="w-full py-5 bg-primary hover:bg-primary/90 disabled:bg-primary/30 text-white rounded-2xl font-bold text-lg shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-3 active:scale-95"
                        >
                          {absenceSubmitting ? <Loader2 className="w-6 h-6 animate-spin" /> : <><span className="material-symbols-outlined">send</span> Enviar Solicitud</>}
                        </button>

                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

        {/* Success Modal */}
        {successMessage && (
          <div className="w-full max-w-md bg-emerald-500 rounded-[2.5rem] p-10 shadow-2xl shadow-emerald-500/20 animate-in fade-in zoom-in duration-300 flex flex-col items-center text-center">
            <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-6 shadow-lg">
              <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            </div>
            <h2 className="text-3xl font-black text-white mb-2">¡Registrado!</h2>
            <p className="text-emerald-50 text-lg font-medium mb-6">
              Fichaje completado a las {successMessage.time}
            </p>
            <div className="w-full h-1 bg-emerald-400/50 rounded-full overflow-hidden">
               <div className="h-full bg-white animate-[shrink_3s_linear_forwards]" />
            </div>
          </div>
        )}

      </div>

      {/* Exit PIN Modal */}
      {showExitModal && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-slate-700 animate-in fade-in zoom-in duration-200">
            <h2 className="text-2xl font-bold text-white text-center mb-2">Desbloquear Kiosko</h2>
            <p className="text-slate-400 text-center mb-6 text-sm">
              Introduce el PIN de 4 dígitos que configuraste para salir.
            </p>

            <div className="mb-6">
              <input
                type="password"
                maxLength={4}
                autoFocus
                placeholder="••••"
                value={exitPin}
                onChange={(e) => {
                  setExitError(false);
                  setExitPin(e.target.value.replace(/\D/g, ''));
                }}
                className={`w-full text-center tracking-[1em] text-3xl py-4 bg-slate-900 border ${exitError ? 'border-red-500' : 'border-slate-700'} rounded-xl text-white focus:outline-none focus:ring-2 ${exitError ? 'focus:ring-red-500/50' : 'focus:ring-primary/50'} placeholder:tracking-normal`}
              />
              {exitError && <p className="text-red-400 text-sm text-center mt-2 font-medium">PIN incorrecto</p>}
            </div>

            <div className="flex gap-4">
              <button 
                onClick={() => {
                  setShowExitModal(false);
                  setExitPin('');
                  setExitError(false);
                }}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-3.5 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={() => {
                  const savedPin = localStorage.getItem('kiosk_pin');
                  if (exitPin === savedPin) {
                    navigate('/setup');
                  } else {
                    setExitError(true);
                  }
                }}
                disabled={exitPin.length !== 4}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-red-500/30 text-white font-bold py-3.5 rounded-xl transition-colors"
              >
                Salir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
