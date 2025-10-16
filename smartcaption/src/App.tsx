import React, { useState, useCallback, useEffect } from 'react';
import {
  Upload,
  Copy,
  Clock,
  Heart,
  Sparkles,
  Image as ImageIcon,
  Zap,
  Star,
  CheckCircle,
  Lightbulb,
  TrendingUp,
  User,
  LogOut,
} from 'lucide-react';
import { supabase } from './lib/supabase';

// --- API Configuration ---
const API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

const callApiWithBackoff = async (payload, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(`${API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        if (response.status === 429 && i < retries - 1) {
          const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new Error(`API call failed with status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
    }
  }
};

const getMimeTypeAndData = (dataUrl) => {
  const parts = dataUrl.split(',');
  if (parts.length < 2) throw new Error('Invalid Data URL');
  const mimePart = parts[0].split(':')[1];
  const mimeType = mimePart.split(';')[0].trim();
  if (!mimeType) throw new Error('MimeType not found in Data URL');
  return { mimeType, data: parts[1] };
};

export default function App() {
  const [image, setImage] = useState(null);
  const [captions, setCaptions] = useState([]);
  const [platform, setPlatform] = useState('');
  const [tone, setTone] = useState('');
  const [language, setLanguage] = useState('');
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedCaption, setCopiedCaption] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const [userCaptions, setUserCaptions] = useState([]);

  const platforms = ['Instagram', 'Facebook', 'TikTok', 'LinkedIn', 'Twitter'];
  const tones = ['Professional', 'Playful', 'Inspirational', 'Witty', 'Direct'];
  const languages = ['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese'];

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async () => {
    if (!email || !password) {
      setErrorMessage('Please enter both email and password');
      return;
    }
    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters');
      return;
    }
    const { data, error } = await supabase.auth.signUp({ 
      email: email.trim(), 
      password
    });
    if (error) {
      setErrorMessage(error.message);
    } else {
      setErrorMessage('Check your email for confirmation link!');
      setEmail('');
      setPassword('');
    }
  };

  const signIn = async () => {
    if (!email || !password) {
      setErrorMessage('Please enter both email and password');
      return;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ 
      email: email.trim(), 
      password 
    });
    if (error) {
      if (error.message.includes('Email not confirmed')) {
        setErrorMessage('Please check your email and click the confirmation link before signing in.');
      } else if (error.message.includes('Invalid login credentials')) {
        setErrorMessage('Invalid email or password. Please try again.');
      } else {
        setErrorMessage(error.message);
      }
    } else {
      setShowAuth(false);
      setEmail('');
      setPassword('');
      setErrorMessage(null);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const saveCaptions = async (captionsToSave) => {
    if (!user) return;
    const { error } = await supabase
      .from('captions')
      .insert({
        user_id: user.id,
        captions: captionsToSave,
        platform,
        tone,
        language,
        additional_info: additionalInfo
      });
    if (error) console.error('Error saving captions:', error);
    else loadUserCaptions();
  };

  const loadUserCaptions = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('captions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) console.error('Error loading captions:', error);
    else setUserCaptions(data || []);
  };

  useEffect(() => {
    if (user) loadUserCaptions();
  }, [user]);

  const handleImageUpload = (e) => {
    setErrorMessage(null);
    const file = e.target.files?.[0];
    if (file) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        setErrorMessage('Unsupported file type. Please use JPG, PNG, or WEBP.');
        return;
      }

      const fileSizeMB = file.size / (1024 * 1024);
      if (fileSizeMB > 4) {
        setErrorMessage('File size too large. Max allowed is 4MB.');
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        setImage(event.target?.result);
        setCaptions([]);
      };
      reader.readAsDataURL(file);
    }
  };

  const generateCaptions = useCallback(async () => {
    if (!image) return;

    setIsGenerating(true);
    setErrorMessage(null);
    setCaptions([]);

    try {
      const { mimeType, data: base64Data } = getMimeTypeAndData(image);

      const systemPrompt = `Generate 5 engaging social media captions for this image. Platform: ${platform || 'general'}, Tone: ${tone || 'engaging'}, Language: ${language || 'English'}. ${additionalInfo ? `Context: ${additionalInfo}` : ''} Return only captions, one per line.`;

      const payload = {
        contents: [{
          parts: [
            { text: systemPrompt },
            { inlineData: { data: base64Data, mimeType } }
          ]
        }],
        generationConfig: { temperature: 0.8 }
      };

      const result = await callApiWithBackoff(payload);
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!text) throw new Error('No captions generated');

      const generatedCaptions = text.split('\n').map(c => c.trim()).filter(c => c.length > 5).slice(0, 5);
      
      setCaptions(generatedCaptions);
      if (user) saveCaptions(generatedCaptions);
    } catch (error) {
      console.error('Error generating captions:', error);
    }
    setIsGenerating(false);
  }, [image, platform, tone, language, additionalInfo, user]);

  const copyCaption = (caption) => {
    navigator.clipboard.writeText(caption);
    setCopiedCaption(caption);
    setTimeout(() => setCopiedCaption(null), 2000);
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/5 backdrop-blur-2xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-r from-orange-500 to-amber-500 rounded-xl flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold">CaptionAI</span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <button onClick={() => setShowProfile(false)} className="text-gray-300 hover:text-white transition-colors">Home</button>
              <a href="#generator" className="text-gray-300 hover:text-white transition-colors">Generator</a>
              <a href="#features" className="text-gray-300 hover:text-white transition-colors">Features</a>
              {user && (
                <button onClick={() => setShowProfile(true)} className="text-gray-300 hover:text-white transition-colors">Profile</button>
              )}
            </div>
            <div className="flex items-center gap-4">
              {user ? (
                <div className="flex items-center gap-3">
                  <User className="w-5 h-5 text-orange-400" />
                  <span className="text-sm">{user.email}</span>
                  <button onClick={signOut} className="text-gray-400 hover:text-white">
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAuth(true)}
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  Sign In
                </button>
              )}
              <button className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white px-6 py-2 rounded-xl font-medium transition-all duration-300">
                Get Started
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Profile Page */}
      {showProfile && user ? (
        <div className="pt-32 px-6 py-16">
          <div className="max-w-4xl mx-auto">
            <div className="bg-white/5 backdrop-blur-2xl rounded-3xl p-8 border border-white/10 shadow-2xl">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-3xl font-bold bg-gradient-to-r from-white to-orange-200 bg-clip-text text-transparent">My Profile</h2>
                  <p className="text-gray-400 mt-2">{user.email}</p>
                </div>
                <button
                  onClick={() => setShowProfile(false)}
                  className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  Back to Home
                </button>
              </div>
              
              <h3 className="text-xl font-bold mb-6">Caption History ({userCaptions.length})</h3>
              
              {userCaptions.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-400">No captions generated yet. Start creating some!</p>
                  <button
                    onClick={() => setShowProfile(false)}
                    className="mt-4 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white px-6 py-3 rounded-xl font-medium transition-all duration-300"
                  >
                    Generate Captions
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  {userCaptions.map((item) => (
                    <div key={item.id} className="bg-white/5 backdrop-blur-xl p-6 rounded-2xl border border-white/10">
                      <div className="flex justify-between items-start mb-4">
                        <div className="text-sm text-gray-400">
                          <span className="font-medium">Platform:</span> {item.platform || 'General'} • 
                          <span className="font-medium">Tone:</span> {item.tone || 'Default'} • 
                          <span className="font-medium">Language:</span> {item.language || 'English'}
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(item.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      
                      {item.additional_info && (
                        <div className="mb-4 p-3 bg-white/5 rounded-lg">
                          <span className="text-sm font-medium text-gray-300">Context: </span>
                          <span className="text-sm text-gray-400">{item.additional_info}</span>
                        </div>
                      )}
                      
                      <div className="space-y-3">
                        {item.captions.map((caption, captionIndex) => (
                          <div key={captionIndex} className="flex items-start justify-between p-3 bg-white/5 rounded-lg">
                            <p className="text-gray-100 flex-1 mr-4">{caption}</p>
                            <button
                              onClick={() => copyCaption(caption)}
                              className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-1 rounded text-sm flex items-center gap-1 transition-colors flex-shrink-0"
                            >
                              <Copy className="w-3 h-3" />
                              {copiedCaption === caption ? 'Copied!' : 'Copy'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
      {/* Header Section */}
      <div id="home" className="relative overflow-hidden pt-32">
        <div className="absolute inset-0 bg-gradient-to-r from-orange-500/10 to-amber-500/10"></div>
        <div className="relative px-6 py-20 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-r from-orange-500 to-amber-500 rounded-3xl mb-8 shadow-2xl">
            <Sparkles className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-6xl font-bold mb-6 bg-gradient-to-r from-white to-orange-200 bg-clip-text text-transparent">
            Image Caption Generator
          </h1>
          <p className="text-xl text-gray-300 mb-12 max-w-2xl mx-auto leading-relaxed">
            AI-powered captions that engage and convert your audience
          </p>
        </div>
      </div>

      {/* File Upload Section */}
      <div id="generator" className="px-6 py-16">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white/5 backdrop-blur-2xl rounded-3xl p-8 border border-white/10 shadow-2xl">
            <h2 className="text-3xl font-bold mb-8 text-center bg-gradient-to-r from-white to-orange-200 bg-clip-text text-transparent">
              Upload Your Image
            </h2>
            
            <label className="block mb-8">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleImageUpload}
                className="hidden"
              />
              <div className="border-2 border-dashed border-orange-500/30 rounded-2xl p-12 text-center cursor-pointer hover:border-orange-500/60 hover:bg-white/5 transition-all duration-300 backdrop-blur-sm">
                {image ? (
                  <div className="space-y-4">
                    <img src={image} alt="Uploaded" className="max-h-64 mx-auto rounded-2xl shadow-lg" />
                    <p className="text-gray-400">Tap to change image</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="w-20 h-20 bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl flex items-center justify-center mx-auto">
                      <ImageIcon className="w-10 h-10 text-white" />
                    </div>
                    <div>
                      <p className="text-2xl font-semibold mb-2">Drop your image here</p>
                      <p className="text-gray-400">or tap to select • JPG, PNG, WEBP</p>
                    </div>
                  </div>
                )}
              </div>
            </label>

            {errorMessage && (
              <div className="bg-red-900/50 text-red-300 p-4 rounded-xl mb-6 border border-red-700/50">
                <p className="font-medium">{errorMessage}</p>
              </div>
            )}

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-semibold mb-3 text-gray-300">Target Platform</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 rounded-2xl px-6 py-4 text-white backdrop-blur-xl focus:border-orange-500/50 focus:outline-none transition-colors"
                >
                  <option value="">Select platform</option>
                  {platforms.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-3 text-gray-300">Caption Tone</label>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    className="w-full bg-white/10 border border-white/20 rounded-2xl px-6 py-4 text-white backdrop-blur-xl focus:border-orange-500/50 focus:outline-none transition-colors"
                  >
                    <option value="">Select tone</option>
                    {tones.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-3 text-gray-300">Language</label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full bg-white/10 border border-white/20 rounded-2xl px-6 py-4 text-white backdrop-blur-xl focus:border-orange-500/50 focus:outline-none transition-colors"
                  >
                    <option value="">Select language</option>
                    {languages.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-3">
                  <label className="text-sm font-semibold text-gray-300">Additional Details</label>
                  <span className="text-sm text-gray-500">Optional</span>
                </div>
                <textarea
                  value={additionalInfo}
                  onChange={(e) => setAdditionalInfo(e.target.value.slice(0, 200))}
                  placeholder="Describe specific aspects to emphasize..."
                  className="w-full bg-white/10 border border-white/20 rounded-2xl px-6 py-4 text-white h-24 resize-none backdrop-blur-xl focus:border-orange-500/50 focus:outline-none transition-colors placeholder-gray-400"
                />
                <div className="text-right text-sm text-gray-500 mt-2">
                  {additionalInfo.length}/200
                </div>
              </div>
            </div>

            <button
              onClick={generateCaptions}
              disabled={!image || isGenerating}
              className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:bg-white/10 disabled:text-gray-500 text-white py-5 rounded-2xl text-lg font-semibold transition-all duration-300 flex items-center justify-center gap-3 shadow-lg mt-8"
            >
              {isGenerating ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Generating...
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5" />
                  Generate Captions
                </>
              )}
            </button>
          </div>

          {/* Generated Captions */}
          {captions.length > 0 && (
            <div className="mt-8 bg-white/5 backdrop-blur-2xl rounded-3xl p-8 border border-white/10 shadow-2xl">
              <h3 className="text-2xl font-bold mb-6 bg-gradient-to-r from-white to-orange-200 bg-clip-text text-transparent">
                Generated Captions
              </h3>
              <div className="space-y-4">
                {captions.map((caption, index) => (
                  <div key={index} className="bg-white/5 backdrop-blur-xl p-6 rounded-2xl border border-white/10">
                    <p className="mb-4 leading-relaxed text-gray-100">{caption}</p>
                    <button
                      onClick={() => copyCaption(caption)}
                      className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white px-6 py-3 rounded-xl flex items-center gap-2 transition-all duration-300 font-medium"
                    >
                      <Copy className="w-4 h-4" />
                      {copiedCaption === caption ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Features Section */}
      <div id="features" className="px-6 py-16">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-16 bg-gradient-to-r from-white to-orange-200 bg-clip-text text-transparent">
            Why Choose Our Generator?
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white/5 backdrop-blur-2xl p-8 rounded-3xl border border-white/10 text-center shadow-xl">
              <div className="w-16 h-16 bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Clock className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold mb-4">Save Time</h3>
              <p className="text-gray-300 leading-relaxed">Generate perfect captions in seconds, not hours of brainstorming</p>
            </div>
            <div className="bg-white/5 backdrop-blur-2xl p-8 rounded-3xl border border-white/10 text-center shadow-xl">
              <div className="w-16 h-16 bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Star className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold mb-4">AI-Powered</h3>
              <p className="text-gray-300 leading-relaxed">Advanced AI analyzes your image to create contextually perfect captions</p>
            </div>
            <div className="bg-white/5 backdrop-blur-2xl p-8 rounded-3xl border border-white/10 text-center shadow-xl">
              <div className="w-16 h-16 bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Heart className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold mb-4">Boost Engagement</h3>
              <p className="text-gray-300 leading-relaxed">Captions designed to increase likes, comments, and shares</p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-white/5 border-t border-white/10 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid md:grid-cols-4 gap-8">
            <div className="col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-gradient-to-r from-orange-500 to-amber-500 rounded-lg flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <span className="text-xl font-bold">CaptionAI</span>
              </div>
              <p className="text-gray-400 mb-4">AI-powered caption generator that helps you create engaging content for all your social media platforms.</p>
              <p className="text-sm text-gray-500">&copy; {new Date().getFullYear()} CaptionAI. All rights reserved.</p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#generator" className="hover:text-white transition-colors">Generator</a></li>
                <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Pricing</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">Help Center</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Privacy</a></li>
              </ul>
            </div>
          </div>
        </div>
      </footer>

      {/* Auth Modal */}
      {showAuth && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-2xl font-bold mb-6">Sign In / Sign Up</h3>
            {errorMessage && (
              <div className={`p-3 rounded-lg mb-4 text-sm ${
                errorMessage.includes('Check your email') 
                  ? 'bg-green-900/50 text-green-300' 
                  : 'bg-red-900/50 text-red-300'
              }`}>
                {errorMessage}
              </div>
            )}
            <div className="space-y-4">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white"
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white"
              />
              <div className="flex gap-3">
                <button onClick={signIn} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-lg font-medium">
                  Sign In
                </button>
                <button onClick={signUp} className="flex-1 bg-gray-600 hover:bg-gray-500 text-white py-3 rounded-lg font-medium">
                  Sign Up
                </button>
              </div>
              <button onClick={() => {
                setShowAuth(false);
                setErrorMessage(null);
                setEmail('');
                setPassword('');
              }} className="w-full text-gray-400 hover:text-white">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}