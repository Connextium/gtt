import React, { useState } from 'react';
import { Check, Shield, Lock, ArrowLeft, ArrowRight, Save, Info, Plus, Search, Edit3, Trash2, ExternalLink, Filter } from 'lucide-react';
import { type ScreenType, type FiatRailItem } from '../types.js';

interface RegisterFiatRailScreenProps {
  items: FiatRailItem[];
  onSaveItem: (item: FiatRailItem, isNew: boolean) => void;
  onDeleteItem: (id: string) => void;
  onNavigate: (screen: ScreenType) => void;
  onShowNotification: (msg: string) => void;
}

export const RegisterFiatRailScreen: React.FC<RegisterFiatRailScreenProps> = ({
  items,
  onSaveItem,
  onDeleteItem,
  onNavigate,
  onShowNotification,
}) => {
  const [mode, setMode] = useState<'LIST' | 'FORM'>('LIST');
  const [editingItem, setEditingItem] = useState<FiatRailItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [purposeFilter, setPurposeFilter] = useState<'ALL' | 'ON_RAMP' | 'OFF_RAMP' | 'DUAL_ACTIVE'>('ALL');

  // Form State
  const [railNickname, setRailNickname] = useState('JPMorgan Chase Operating Wire');
  const [settlementPurpose, setSettlementPurpose] = useState<'ON_RAMP' | 'OFF_RAMP' | 'DUAL_ACTIVE'>('DUAL_ACTIVE');
  const [bankingInstitution, setBankingInstitution] = useState('JPMorgan Chase Bank, N.A.');
  const [routingTransitId, setRoutingTransitId] = useState('021000021');
  const [accountNumber, setAccountNumber] = useState('9823410988');
  const [confirmAccountNumber, setConfirmAccountNumber] = useState('9823410988');
  const [autoProvisionAda, setAutoProvisionAda] = useState(true);

  // Address fields
  const [beneficiaryName, setBeneficiaryName] = useState('Vanguard Digital Asset Ltd');
  const [taxId, setTaxId] = useState('13-9824102-A');
  const [streetAddress, setStreetAddress] = useState('383 Madison Avenue, Fl 14');
  const [city, setCity] = useState('New York');
  const [state, setState] = useState('NY');
  const [zipCode, setZipCode] = useState('10179');
  const [country, setCountry] = useState('United States (US)');

  const handleStartAddNew = () => {
    setEditingItem(null);
    setRailNickname('');
    setSettlementPurpose('DUAL_ACTIVE');
    setBankingInstitution('');
    setRoutingTransitId('');
    setAccountNumber('');
    setConfirmAccountNumber('');
    setAutoProvisionAda(true);
    setBeneficiaryName('Vanguard Digital Asset Ltd');
    setTaxId('13-9824102-A');
    setStreetAddress('');
    setCity('');
    setState('');
    setZipCode('');
    setCountry('United States (US)');
    setMode('FORM');
  };

  const handleStartEdit = (rail: FiatRailItem) => {
    setEditingItem(rail);
    setRailNickname(rail.railNickname);
    setSettlementPurpose(rail.settlementPurpose);
    setBankingInstitution(rail.bankingInstitution);
    setRoutingTransitId(rail.routingTransitId);
    setAccountNumber(rail.accountNumber);
    setConfirmAccountNumber(rail.accountNumber);
    setAutoProvisionAda(rail.autoProvisionAda);
    setBeneficiaryName(rail.beneficiaryName);
    setTaxId(rail.taxId);
    setStreetAddress(rail.streetAddress);
    setCity(rail.city);
    setState(rail.state);
    setZipCode(rail.zipCode);
    setCountry(rail.country);
    setMode('FORM');
  };

  const handleSaveDraft = () => {
    onShowNotification('Draft saved to local encrypted HSM buffer [SESSION_DRAFT_4920]');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const isNew = !editingItem;
    const itemToSave: FiatRailItem = {
      id: editingItem ? editingItem.id : `rail-fiat-${Date.now()}`,
      railNickname,
      settlementPurpose,
      bankingInstitution,
      routingTransitId,
      accountNumber,
      currencyCode: 'USD',
      beneficiaryName,
      taxId,
      streetAddress,
      city,
      state,
      zipCode,
      country,
      autoProvisionAda,
      status: editingItem ? editingItem.status : 'ACTIVE_VERIFIED',
      clearingProtocol: routingTransitId.length === 9 ? 'FEDWIRE_DIRECT' : 'SWIFT_MT103',
      lastActive: 'Just now',
    };

    onSaveItem(itemToSave, isNew);
    onShowNotification(
      isNew
        ? `Successfully registered new Fiat Rail: ${railNickname}`
        : `Updated Fiat Rail: ${railNickname}`
    );
    setMode('LIST');
  };

  const filteredItems = items.filter((item) => {
    const matchesQuery =
      item.railNickname.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.bankingInstitution.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.routingTransitId.includes(searchQuery);
    const matchesPurpose = purposeFilter === 'ALL' || item.settlementPurpose === purposeFilter;
    return matchesQuery && matchesPurpose;
  });

  return (
    <div className="p-3 sm:p-4 lg:p-5 max-w-[1520px] mx-auto">
      {/* Top Breadcrumb Header */}
      <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-[#757575] mb-2 pb-1.5 border-b border-[#e0e0e0] gap-1.5">
        <div className="flex items-center gap-2">
          <span className="hover:text-black cursor-pointer">Business Client Portal</span>
          <span>/</span>
          <span className="text-black font-semibold">Predefined Rails Registry</span>
          <span>/</span>
          <span className="text-black font-bold">Fiat Clearing Rails</span>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode('LIST')}
            className={`px-2 py-0.5 text-[10px] font-mono border transition-colors ${
              mode === 'LIST'
                ? 'bg-black text-white font-bold border-black'
                : 'bg-white text-[#666] border-[#d4d4d4] hover:border-black'
            }`}
          >
            List Overview ({items.length})
          </button>
          <button
            type="button"
            onClick={() => {
              if (mode === 'LIST') handleStartAddNew();
            }}
            className={`px-2 py-0.5 text-[10px] font-mono border transition-colors ${
              mode === 'FORM'
                ? 'bg-black text-white font-bold border-black'
                : 'bg-white text-[#666] border-[#d4d4d4] hover:border-black'
            }`}
          >
            {editingItem ? 'Edit Rail Form' : '+ Register New Rail'}
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODE 1: LIST VIEW                                                        */}
      {/* ========================================================================= */}
      {mode === 'LIST' && (
        <div className="space-y-3.5">
          {/* Section Heading & Quick Stats */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-caslon text-2xl sm:text-3xl text-black font-normal tracking-tight">
              Predefined Fiat Clearing Rails
            </h1>

            <button
              type="button"
              onClick={handleStartAddNew}
              className="bg-black hover:bg-[#222] text-white px-3.5 py-1.5 text-xs font-franklin font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors shadow-none"
            >
              <Plus className="w-3.5 h-3.5" />
              Register New Fiat Rail
            </button>
          </div>

          {/* Institutional KPI Metric Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-white border border-[#e0e0e0] p-2.5">
              <div className="text-[9px] font-mono uppercase text-[#757575] font-semibold">Total Registered Rails</div>
              <div className="font-caslon text-xl font-bold text-black mt-0.5">{items.length} Rails</div>
            </div>

            <div className="bg-white border border-[#e0e0e0] p-2.5">
              <div className="text-[9px] font-mono uppercase text-[#757575] font-semibold">Dual-Active Clearing</div>
              <div className="font-caslon text-xl font-bold text-black mt-0.5">
                {items.filter((i) => i.settlementPurpose === 'DUAL_ACTIVE').length} Active
              </div>
            </div>

            <div className="bg-white border border-[#e0e0e0] p-2.5">
              <div className="text-[9px] font-mono uppercase text-[#757575] font-semibold">Daily Clearing Window</div>
              <div className="font-caslon text-xl font-bold text-black mt-0.5">21.5 hrs/day</div>
            </div>

            <div className="bg-white border border-[#e0e0e0] p-2.5">
              <div className="text-[9px] font-mono uppercase text-[#757575] font-semibold">Settlement Status</div>
              <div className="font-caslon text-xl font-bold text-[#10b981] mt-0.5">100% Clear</div>
            </div>
          </div>

          {/* Search and Filters Bar */}
          <div className="bg-white border border-[#e0e0e0] p-2.5 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 flex-1 min-w-[240px]">
              <div className="relative w-full max-w-sm">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#757575]" />
                <input
                  type="text"
                  placeholder="Search by nickname, bank, routing transit..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-1.5 border border-[#d4d4d4] text-xs font-mono text-black focus:outline-none focus:border-black"
                />
              </div>
            </div>

            <div className="flex items-center gap-1 text-[10px] font-mono">
              <span className="text-[#757575] uppercase mr-1">Purpose:</span>
              <button
                type="button"
                onClick={() => setPurposeFilter('ALL')}
                className={`px-2 py-0.5 border ${
                  purposeFilter === 'ALL'
                    ? 'border-black bg-black text-white font-bold'
                    : 'border-[#d4d4d4] bg-white text-[#4c4546]'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setPurposeFilter('DUAL_ACTIVE')}
                className={`px-2 py-0.5 border ${
                  purposeFilter === 'DUAL_ACTIVE'
                    ? 'border-black bg-black text-white font-bold'
                    : 'border-[#d4d4d4] bg-white text-[#4c4546]'
                }`}
              >
                Dual Active
              </button>
              <button
                type="button"
                onClick={() => setPurposeFilter('ON_RAMP')}
                className={`px-2 py-0.5 border ${
                  purposeFilter === 'ON_RAMP'
                    ? 'border-black bg-black text-white font-bold'
                    : 'border-[#d4d4d4] bg-white text-[#4c4546]'
                }`}
              >
                On-Ramp Only
              </button>
              <button
                type="button"
                onClick={() => setPurposeFilter('OFF_RAMP')}
                className={`px-2 py-0.5 border ${
                  purposeFilter === 'OFF_RAMP'
                    ? 'border-black bg-black text-white font-bold'
                    : 'border-[#d4d4d4] bg-white text-[#4c4546]'
                }`}
              >
                Off-Ramp Only
              </button>
            </div>
          </div>

          {/* Data Table */}
          <div className="bg-white border border-black overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-black bg-[#f5f5f5] text-[10px] font-mono uppercase text-[#555]">
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Rail Label &amp; Banking Entity</th>
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Routing / Transit (ABA)</th>
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Account &amp; Beneficiary</th>
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Purpose &amp; Protocol</th>
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Status</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e0e0e0] font-mono text-[11px]">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[#757575] font-mono">
                      No fiat rails found matching the criteria. Click &quot;Register New Fiat Rail&quot; to add one.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((rail) => (
                    <tr key={rail.id} className="hover:bg-[#fafafa] transition-colors">
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <div className="font-franklin font-bold text-xs text-black">{rail.railNickname}</div>
                        <div className="text-[10px] font-franklin text-[#666]">{rail.bankingInstitution}</div>
                        <div className="text-[9px] text-[#888]">{rail.city}, {rail.state}</div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <div className="font-bold text-black">{rail.routingTransitId}</div>
                        <div className="text-[9px] text-[#757575]">FEDWIRE MASTER VERIFIED</div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <div className="text-black font-semibold">••••{rail.accountNumber.slice(-4) || '••••'}</div>
                        <div className="text-[10px] font-franklin text-[#555]">{rail.beneficiaryName}</div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <span className={`inline-block px-1.5 py-0.5 text-[9px] uppercase font-bold border ${
                          rail.settlementPurpose === 'DUAL_ACTIVE'
                            ? 'bg-black text-white border-black'
                            : rail.settlementPurpose === 'ON_RAMP'
                            ? 'bg-[#e0f2fe] text-[#0369a1] border-[#bae6fd]'
                            : 'bg-[#fef3c7] text-[#92400e] border-[#fde68a]'
                        }`}>
                          {rail.settlementPurpose.replace('_', ' ')}
                        </span>
                        <div className="text-[9px] text-[#757575] mt-0.5">{rail.clearingProtocol}</div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <span className="inline-flex items-center gap-1 text-[10px] text-[#10b981] font-bold">
                          <span className="w-1.5 h-1.5 bg-[#10b981] inline-block"></span>
                          {rail.status}
                        </span>
                        <div className="text-[9px] text-[#757575]">{rail.lastActive}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(rail)}
                            title="Edit Rail Parameters"
                            className="border border-black bg-white hover:bg-[#f0f0f0] text-black px-2 py-1 text-[10px] font-franklin font-bold uppercase tracking-wider flex items-center gap-1"
                          >
                            <Edit3 className="w-3 h-3" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => onNavigate('PROVISION_FIAT_ADA')}
                            title="Provision ADA for this Rail"
                            className="border border-[#d4d4d4] bg-[#fbfbfb] hover:border-black text-[#333] px-2 py-1 text-[10px] font-franklin font-semibold uppercase tracking-wider"
                          >
                            ADA &rarr;
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Are you sure you want to deactivate rail: ${rail.railNickname}?`)) {
                                onDeleteItem(rail.id);
                                onShowNotification(`Deactivated fiat clearing rail: ${rail.railNickname}`);
                              }
                            }}
                            title="Deactivate Rail"
                            className="p-1 text-[#ba1a1a] hover:bg-[#fee2e2] border border-transparent hover:border-[#fca5a5]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 2: FORM VIEW (ADD NEW OR EDIT EXISTING)                              */}
      {/* ========================================================================= */}
      {mode === 'FORM' && (
        <div>
          {/* Back Action & Mode Header */}
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMode('LIST')}
                className="border border-black bg-white hover:bg-[#f5f5f5] text-black px-2.5 py-1 text-xs font-franklin font-bold uppercase tracking-wider flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Rails List
              </button>
              <div>
                <h1 className="font-caslon text-2xl text-black font-normal tracking-tight">
                  {editingItem ? `Edit Existing Rail: ${editingItem.railNickname}` : 'Register Predefined Fiat Wire Rail'}
                </h1>
                <div className="text-[10px] font-mono text-[#757575] uppercase">
                  {editingItem ? `ID: ${editingItem.id} // STATUS: ${editingItem.status}` : 'MODE: NEW REGISTRATION'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMode('LIST')}
                className="border border-[#d4d4d4] bg-white hover:bg-[#f5f5f5] text-[#555] px-3 py-1.5 text-xs font-franklin font-bold uppercase tracking-wider"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveDraft}
                className="border border-black bg-white hover:bg-[#f5f5f5] text-black px-3 py-1.5 text-xs font-franklin font-bold uppercase tracking-wider flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                Save Draft
              </button>
            </div>
          </div>

          {/* Form Grid */}
          <form onSubmit={handleSubmit} className="grid grid-cols-12 gap-3.5">
            {/* Left Column (7 cols) */}
            <div className="col-span-7 space-y-3.5">
              {/* SECTION 01: RAIL METADATA & PURPOSE */}
              <div className="bg-white border border-[#e0e0e0] p-3.5 relative">
                <div className="flex items-center justify-between border-b border-[#e0e0e0] pb-2 mb-3">
                  <span className="text-[11px] font-mono font-bold tracking-widest text-black uppercase">
                    Rail Metadata &amp; Purpose
                  </span>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                      Rail Nickname / Label <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={railNickname}
                      onChange={(e) => setRailNickname(e.target.value)}
                      className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-franklin text-black focus:outline-none focus:ring-1 focus:ring-black"
                      placeholder="e.g. JPMorgan Chase Operating Wire"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1.5">
                      Settlement Purpose <span className="text-red-600">*</span>
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div
                        onClick={() => setSettlementPurpose('ON_RAMP')}
                        className={`border p-2.5 cursor-pointer transition-all relative ${
                          settlementPurpose === 'ON_RAMP'
                            ? 'border-black bg-[#fbfbfb] ring-1 ring-black'
                            : 'border-[#d4d4d4] hover:border-black bg-white'
                        }`}
                      >
                        {settlementPurpose === 'ON_RAMP' && (
                          <div className="absolute top-1.5 right-1.5">
                            <Check className="w-3.5 h-3.5 text-black stroke-[3]" />
                          </div>
                        )}
                        <div className="font-franklin font-bold text-xs uppercase tracking-wider text-black">
                          On-Ramp
                        </div>
                        <div className="text-[10px] text-[#757575] mt-0.5 font-franklin">Funding</div>
                      </div>

                      <div
                        onClick={() => setSettlementPurpose('OFF_RAMP')}
                        className={`border p-2.5 cursor-pointer transition-all relative ${
                          settlementPurpose === 'OFF_RAMP'
                            ? 'border-black bg-[#fbfbfb] ring-1 ring-black'
                            : 'border-[#d4d4d4] hover:border-black bg-white'
                        }`}
                      >
                        {settlementPurpose === 'OFF_RAMP' && (
                          <div className="absolute top-1.5 right-1.5">
                            <Check className="w-3.5 h-3.5 text-black stroke-[3]" />
                          </div>
                        )}
                        <div className="font-franklin font-bold text-xs uppercase tracking-wider text-black">
                          Off-Ramp
                        </div>
                        <div className="text-[10px] text-[#757575] mt-0.5 font-franklin">Redemption</div>
                      </div>

                      <div
                        onClick={() => setSettlementPurpose('DUAL_ACTIVE')}
                        className={`border p-2.5 cursor-pointer transition-all relative ${
                          settlementPurpose === 'DUAL_ACTIVE'
                            ? 'border-black bg-[#fbfbfb] ring-2 ring-black'
                            : 'border-[#d4d4d4] hover:border-black bg-white'
                        }`}
                      >
                        {settlementPurpose === 'DUAL_ACTIVE' && (
                          <div className="absolute top-1.5 right-1.5">
                            <Check className="w-3.5 h-3.5 text-black stroke-[3]" />
                          </div>
                        )}
                        <div className="font-franklin font-bold text-xs uppercase tracking-wider text-black">
                          Dual Active
                        </div>
                        <div className="text-[10px] text-[#4c4546] mt-0.5 font-franklin font-semibold">
                          Bidirectional
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 02: CLEARING & ROUTING IDENTIFIERS */}
              <div className="bg-white border border-[#e0e0e0] p-3.5">
                <div className="flex items-center justify-between border-b border-[#e0e0e0] pb-2 mb-3">
                  <span className="text-[11px] font-mono font-bold tracking-widest text-black uppercase">
                    Clearing &amp; Routing
                  </span>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                      Banking Institution Name <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={bankingInstitution}
                      onChange={(e) => setBankingInstitution(e.target.value)}
                      className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-franklin text-black focus:outline-none"
                      placeholder="e.g. JPMorgan Chase Bank, N.A."
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                        Routing / Transit ID (ABA / SWIFT) <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={routingTransitId}
                        onChange={(e) => setRoutingTransitId(e.target.value)}
                        className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-mono text-black focus:outline-none"
                        placeholder="021000021"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                        Currency
                      </label>
                      <div className="border border-[#e0e0e0] bg-[#f5f5f5] px-2.5 py-1.5 text-xs font-mono text-black">
                        USD &mdash; US Dollar
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                        Corporate Account Number <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={accountNumber}
                        onChange={(e) => setAccountNumber(e.target.value)}
                        className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-mono text-black focus:outline-none"
                        placeholder="Account number"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                        Confirm Account Number <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={confirmAccountNumber}
                        onChange={(e) => setConfirmAccountNumber(e.target.value)}
                        className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-mono text-black focus:outline-none"
                        placeholder="Re-enter account number"
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 03: BENEFICIARY ENTITY DETAILS */}
              <div className="bg-white border border-[#e0e0e0] p-3.5">
                <div className="flex items-center justify-between border-b border-[#e0e0e0] pb-2 mb-3">
                  <span className="text-[11px] font-mono font-bold tracking-widest text-black uppercase">
                    Beneficiary Entity Details
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                        Legal Entity Name <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={beneficiaryName}
                        onChange={(e) => setBeneficiaryName(e.target.value)}
                        className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-franklin text-black focus:outline-none"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                        Tax ID / EIN / LEI <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={taxId}
                        onChange={(e) => setTaxId(e.target.value)}
                        className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-mono text-black focus:outline-none"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                      Street Address <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={streetAddress}
                      onChange={(e) => setStreetAddress(e.target.value)}
                      className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-franklin text-black focus:outline-none"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                        City <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-franklin text-black focus:outline-none"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                        State <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={state}
                        onChange={(e) => setState(e.target.value)}
                        className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-franklin text-black focus:outline-none"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                        Postal Code <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={zipCode}
                        onChange={(e) => setZipCode(e.target.value)}
                        className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-mono text-black focus:outline-none"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                        Country
                      </label>
                      <input
                        type="text"
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        className="w-full border border-[#d4d4d4] bg-[#f9f9f9] px-2.5 py-1.5 text-xs font-franklin text-black focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 04: DOWNSTREAM ADA AUTOMATION */}
              <div className="bg-white border border-[#e0e0e0] p-3.5">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    id="auto-provision"
                    checked={autoProvisionAda}
                    onChange={(e) => setAutoProvisionAda(e.target.checked)}
                    className="h-4 w-4 border border-black accent-black rounded-none cursor-pointer"
                  />
                  <span className="text-xs font-franklin font-bold uppercase tracking-wider text-black">
                    Auto-provision linked Fiat ADA Account
                  </span>
                </label>
              </div>
            </div>

            {/* Right Column: Specimen Preview & Actions (5 cols) */}
            <div className="col-span-5 space-y-3.5">
              {/* SPECIMEN PREVIEW */}
              <div className="bg-white border border-black p-3.5">
                <div className="flex items-center justify-between border-b border-[#e0e0e0] pb-2 mb-3">
                  <div className="flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-black" />
                    <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-black">
                      Payload Preview
                    </span>
                  </div>
                  <span className="text-[9px] font-mono text-[#757575]">ISO-20022</span>
                </div>

                <div className="bg-[#111] text-[#e0e0e0] font-mono text-[10px] p-3 border border-black overflow-x-auto space-y-1">
                  <div><span className="text-[#888]">{'{'}</span></div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;rail_id&quot;</span>: <span className="text-white">&quot;{editingItem?.id || 'RAIL-NEW-SPEC'}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;nickname&quot;</span>: <span className="text-white">&quot;{railNickname || 'Untitled'}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;settlement_type&quot;</span>: <span className="text-white">&quot;{settlementPurpose}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;bank_name&quot;</span>: <span className="text-white">&quot;{bankingInstitution}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;routing&quot;</span>: <span className="text-white">&quot;{routingTransitId}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;account_hash&quot;</span>: <span className="text-white">&quot;0x{btoa(accountNumber || '0000').slice(0, 16)}...&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;beneficiary&quot;</span>: <span className="text-white">&quot;{beneficiaryName}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;auto_ada&quot;</span>: <span className="text-[#10b981]">{autoProvisionAda ? 'true' : 'false'}</span></div>
                  <div><span className="text-[#888]">{'}'}</span></div>
                </div>
              </div>

              {/* SUBMIT BUTTONS */}
              <div className="space-y-2 pt-1">
                <button
                  type="submit"
                  className="w-full bg-black hover:bg-[#222] text-white py-2 px-4 text-xs font-franklin font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors shadow-none"
                >
                  {editingItem ? 'Save Changes' : 'Register Fiat Rail'}
                </button>

                <button
                  type="button"
                  onClick={() => setMode('LIST')}
                  className="w-full border border-black bg-white hover:bg-[#f5f5f5] text-black py-1.5 px-4 text-xs font-franklin font-bold uppercase tracking-wider transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
