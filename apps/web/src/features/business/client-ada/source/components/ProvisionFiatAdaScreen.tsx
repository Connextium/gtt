import React, { useState } from 'react';
import { Shield, Lock, ArrowLeft, ArrowRight, Save, Ban, Check, CheckCircle2, Plus, Search, Edit3, Trash2, Sliders, RefreshCw } from 'lucide-react';
import { type ScreenType, type FiatAdaItem, type FiatRailItem } from '../types.js';

interface ProvisionFiatAdaScreenProps {
  items: FiatAdaItem[];
  fiatRails: FiatRailItem[];
  onSaveItem: (item: FiatAdaItem, isNew: boolean) => void;
  onDeleteItem: (id: string) => void;
  onNavigate: (screen: ScreenType) => void;
  onShowNotification: (msg: string) => void;
}

export const ProvisionFiatAdaScreen: React.FC<ProvisionFiatAdaScreenProps> = ({
  items,
  fiatRails,
  onSaveItem,
  onDeleteItem,
  onNavigate,
  onShowNotification,
}) => {
  const [mode, setMode] = useState<'LIST' | 'FORM'>('LIST');
  const [editingItem, setEditingItem] = useState<FiatAdaItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Form states
  const [accountDisplayName, setAccountDisplayName] = useState('Primary Operating Fiat Treasury');
  const [underlyingCurrency, setUnderlyingCurrency] = useState('USD (United States Dollar)');
  const [settlementVehicle, setSettlementVehicle] = useState('Fedwire Direct / Institutional Settlement');
  const [selectedRail, setSelectedRail] = useState(
    fiatRails.length > 0 ? `${fiatRails[0].bankingInstitution} (${fiatRails[0].routingTransitId})` : 'JPMorgan Chase Bank, N.A. (ABA 021000021)'
  );
  const [minOperatingBalance, setMinOperatingBalance] = useState('250,000.00');
  const [targetSweepTrigger, setTargetSweepTrigger] = useState('5,000,000.00');
  const [allowFunding, setAllowFunding] = useState(true);
  const [allowRedemption, setAllowRedemption] = useState(true);

  const handleStartAddNew = () => {
    setEditingItem(null);
    setAccountDisplayName('');
    setUnderlyingCurrency('USD (United States Dollar)');
    setSettlementVehicle('Fedwire Direct / Institutional Settlement');
    setSelectedRail(
      fiatRails.length > 0
        ? `${fiatRails[0].bankingInstitution} (${fiatRails[0].routingTransitId})`
        : 'JPMorgan Chase Bank, N.A. (ABA 021000021)'
    );
    setMinOperatingBalance('250,000.00');
    setTargetSweepTrigger('5,000,000.00');
    setAllowFunding(true);
    setAllowRedemption(true);
    setMode('FORM');
  };

  const handleStartEdit = (ada: FiatAdaItem) => {
    setEditingItem(ada);
    setAccountDisplayName(ada.accountDisplayName);
    setUnderlyingCurrency(ada.underlyingCurrency);
    setSettlementVehicle(ada.settlementVehicle);
    setSelectedRail(ada.selectedRail);
    setMinOperatingBalance(ada.minOperatingBalance);
    setTargetSweepTrigger(ada.targetSweepTrigger);
    setAllowFunding(ada.allowFunding);
    setAllowRedemption(ada.allowRedemption);
    setMode('FORM');
  };

  const handleSaveDraft = () => {
    onShowNotification('Draft parameters saved to HSM enclave cache [SPEC_4.8.2-SEC]');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const isNew = !editingItem;
    const randomSuffix = Math.floor(10 + Math.random() * 90);
    const itemToSave: FiatAdaItem = {
      id: editingItem ? editingItem.id : `ada-fiat-${Date.now()}`,
      accountId: editingItem ? editingItem.accountId : `ADA-8804-TR-${randomSuffix}`,
      accountDisplayName,
      underlyingCurrency,
      settlementVehicle,
      selectedRail,
      balance: editingItem ? editingItem.balance : '$0.00 USD',
      minOperatingBalance,
      targetSweepTrigger,
      allowFunding,
      allowRedemption,
      status: editingItem ? editingItem.status : 'ACTIVE_ON_LEDGER',
      ledgerNode: 'NYC-FED-01',
      lastReconciliation: 'Today, Just now (0 drift)',
    };

    onSaveItem(itemToSave, isNew);
    onShowNotification(
      isNew
        ? `Successfully provisioned Fiat ADA: ${accountDisplayName} [${itemToSave.accountId}]`
        : `Updated Fiat ADA: ${accountDisplayName}`
    );
    setMode('LIST');
  };

  const filteredItems = items.filter((item) => {
    return (
      item.accountDisplayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.accountId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.selectedRail.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <div className="p-3 sm:p-4 lg:p-5 max-w-[1520px] mx-auto">
      {/* Top Breadcrumb Bar */}
      <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-[#757575] mb-2 pb-1.5 border-b border-[#e0e0e0] gap-1.5">
        <div className="flex items-center gap-2">
          <span className="hover:text-black cursor-pointer">Business Client Portal</span>
          <span>/</span>
          <span className="hover:text-black cursor-pointer">Accounts (ADA)</span>
          <span>/</span>
          <span className="text-black font-semibold">Encapsulated Fiat ADA Accounts</span>
        </div>

        {/* View Mode Switcher */}
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
            {editingItem ? 'Edit ADA Form' : '+ Provision New ADA'}
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODE 1: LIST VIEW                                                        */}
      {/* ========================================================================= */}
      {mode === 'LIST' && (
        <div className="space-y-3.5">
          {/* Header Block */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-caslon text-2xl sm:text-3xl text-black font-normal tracking-tight">
              Encapsulated Fiat ADA Accounts
            </h1>

            <button
              type="button"
              onClick={handleStartAddNew}
              className="bg-black hover:bg-[#222] text-white px-3.5 py-1.5 text-xs font-franklin font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors shadow-none"
            >
              <Plus className="w-3.5 h-3.5" />
              Provision New Fiat ADA
            </button>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-white border border-[#e0e0e0] p-2.5">
              <div className="text-[9px] font-mono uppercase text-[#757575] font-semibold">Total Accounts</div>
              <div className="font-caslon text-xl font-bold text-black mt-0.5">{items.length} Active</div>
            </div>

            <div className="bg-white border border-[#e0e0e0] p-2.5">
              <div className="text-[9px] font-mono uppercase text-[#757575] font-semibold">Total Fiat Liquidity</div>
              <div className="font-caslon text-xl font-bold text-black mt-0.5">$21,800,000.00</div>
            </div>

            <div className="bg-white border border-[#e0e0e0] p-2.5">
              <div className="text-[9px] font-mono uppercase text-[#757575] font-semibold">Boundary Standard</div>
              <div className="font-caslon text-xl font-bold text-black mt-0.5">ISO-20022</div>
            </div>

            <div className="bg-white border border-[#e0e0e0] p-2.5">
              <div className="text-[9px] font-mono uppercase text-[#757575] font-semibold">Ledger Variance</div>
              <div className="font-caslon text-xl font-bold text-[#10b981] mt-0.5">0.00 USD</div>
            </div>
          </div>

          {/* Search Bar */}
          <div className="bg-white border border-[#e0e0e0] p-2.5">
            <div className="relative w-full max-w-sm">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#757575]" />
              <input
                type="text"
                placeholder="Search by compartment name, ADA ID, bound rail..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1.5 border border-[#d4d4d4] text-xs font-mono text-black focus:outline-none focus:border-black"
              />
            </div>
          </div>

          {/* Data Table */}
          <div className="bg-white border border-black overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-black bg-[#f5f5f5] text-[10px] font-mono uppercase text-[#555]">
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Compartment ID &amp; Name</th>
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Bound Settlement Rail</th>
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Current Sub-Ledger Balance</th>
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Liquidity Guard &amp; Triggers</th>
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Permitted Operations</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e0e0e0] font-mono text-[11px]">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[#757575] font-mono">
                      No fiat ADA accounts found. Click &quot;Provision New Fiat ADA&quot; to allocate one.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((ada) => (
                    <tr key={ada.id} className="hover:bg-[#fafafa] transition-colors">
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <div className="font-bold text-black flex items-center gap-1.5">
                          <span>{ada.accountId}</span>
                          <span className="w-1.5 h-1.5 bg-[#10b981] inline-block"></span>
                        </div>
                        <div className="font-franklin text-xs text-[#222] font-semibold">{ada.accountDisplayName}</div>
                        <div className="text-[9px] text-[#888]">{ada.ledgerNode}</div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <div className="text-black font-semibold">{ada.selectedRail}</div>
                        <div className="text-[10px] text-[#666]">{ada.settlementVehicle}</div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <div className="font-caslon text-sm font-bold text-black">{ada.balance}</div>
                        <div className="text-[9px] text-[#10b981]">{ada.lastReconciliation}</div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <div className="text-[10px]">
                          Min: <strong className="text-black">${ada.minOperatingBalance}</strong>
                        </div>
                        <div className="text-[10px] text-[#666]">
                          Sweep Trigger: ${ada.targetSweepTrigger}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <div className="flex flex-wrap gap-1">
                          {ada.allowFunding && (
                            <span className="px-1.5 py-0.2 bg-[#dcfce7] text-[#166534] border border-[#bbf7d0] text-[9px] font-bold">
                              FUNDING
                            </span>
                          )}
                          {ada.allowRedemption && (
                            <span className="px-1.5 py-0.2 bg-[#e0f2fe] text-[#0369a1] border border-[#bae6fd] text-[9px] font-bold">
                              REDEMPTION
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(ada)}
                            title="Edit Compartment Parameters"
                            className="border border-black bg-white hover:bg-[#f0f0f0] text-black px-2 py-1 text-[10px] font-franklin font-bold uppercase tracking-wider flex items-center gap-1"
                          >
                            <Edit3 className="w-3 h-3" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onShowNotification(`Simulated sweep calculation for ${ada.accountId}: 0 sweep delta required.`);
                            }}
                            title="Simulate Sweep"
                            className="border border-[#d4d4d4] bg-[#fbfbfb] hover:border-black text-[#333] px-2 py-1 text-[10px] font-franklin font-semibold uppercase tracking-wider"
                          >
                            Sweep
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Are you sure you want to de-provision ${ada.accountId}?`)) {
                                onDeleteItem(ada.id);
                                onShowNotification(`De-provisioned ${ada.accountId}`);
                              }
                            }}
                            title="De-provision"
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
          {/* Back Action Bar */}
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMode('LIST')}
                className="border border-black bg-white hover:bg-[#f5f5f5] text-black px-2.5 py-1 text-xs font-franklin font-bold uppercase tracking-wider flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Accounts List
              </button>
              <div>
                <h1 className="font-caslon text-2xl text-black font-normal tracking-tight">
                  {editingItem ? `Edit Encapsulated ADA: ${editingItem.accountId}` : 'Provision Encapsulated ADA: Fiat-Only Compartment'}
                </h1>
                <div className="text-[10px] font-mono text-[#757575] uppercase">
                  {editingItem ? `STATUS: ${editingItem.status} // RECONCILED: ${editingItem.lastReconciliation}` : 'NEW SUB-LEDGER RECORD'}
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

          {/* Main Form Columns */}
          <form onSubmit={handleSubmit} className="grid grid-cols-12 gap-3.5">
            {/* Left Column (7 cols): Architecture & Rail Binding */}
            <div className="col-span-7 space-y-3.5">
              <div className="bg-white border border-[#e0e0e0] p-3.5">
                <div className="border-b border-black pb-1.5 mb-3">
                  <h2 className="text-xs font-franklin font-bold uppercase tracking-wider text-black">
                    Account Architecture &amp; Rail Binding
                  </h2>
                </div>

                <div className="space-y-3">
                  {/* Display Name */}
                  <div>
                    <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                      Account Display Name <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={accountDisplayName}
                      onChange={(e) => setAccountDisplayName(e.target.value)}
                      className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-franklin text-black focus:outline-none"
                      placeholder="e.g. Primary Operating Fiat Treasury"
                      required
                    />
                  </div>

                  {/* Currencies & Settlement */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                        Denomination Currency
                      </label>
                      <input
                        type="text"
                        value={underlyingCurrency}
                        onChange={(e) => setUnderlyingCurrency(e.target.value)}
                        className="w-full border border-[#d4d4d4] bg-[#f9f9f9] px-2.5 py-1.5 text-xs font-mono text-black focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                        Settlement Vehicle
                      </label>
                      <input
                        type="text"
                        value={settlementVehicle}
                        onChange={(e) => setSettlementVehicle(e.target.value)}
                        className="w-full border border-[#d4d4d4] bg-[#f9f9f9] px-2.5 py-1.5 text-xs font-mono text-black focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Bound Fiat Rail Dropdown */}
                  <div>
                    <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                      Bound Predefined Fiat Rail <span className="text-red-600">*</span>
                    </label>
                    <select
                      value={selectedRail}
                      onChange={(e) => setSelectedRail(e.target.value)}
                      className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-mono text-black focus:outline-none cursor-pointer"
                    >
                      {fiatRails.map((rail) => (
                        <option key={rail.id} value={`${rail.bankingInstitution} (${rail.routingTransitId})`}>
                          {rail.bankingInstitution} (ABA {rail.routingTransitId}) - {rail.railNickname}
                        </option>
                      ))}
                      {fiatRails.length === 0 && (
                        <option value="JPMorgan Chase Bank, N.A. (021000021)">
                          JPMorgan Chase Bank, N.A. (ABA 021000021)
                        </option>
                      )}
                    </select>
                  </div>
                </div>
              </div>

              {/* Operating Liquidity Reserves */}
              <div className="bg-white border border-[#e0e0e0] p-3.5">
                <div className="border-b border-black pb-1.5 mb-3">
                  <h2 className="text-xs font-franklin font-bold uppercase tracking-wider text-black">
                    Operating Liquidity Parameters
                  </h2>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                      Minimum Operating Reserve (USD)
                    </label>
                    <input
                      type="text"
                      value={minOperatingBalance}
                      onChange={(e) => setMinOperatingBalance(e.target.value)}
                      className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-mono text-black focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                      Target Sweep Trigger Threshold (USD)
                    </label>
                    <input
                      type="text"
                      value={targetSweepTrigger}
                      onChange={(e) => setTargetSweepTrigger(e.target.value)}
                      className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-mono text-black focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Permitted Instruction Subtypes */}
              <div className="bg-white border border-[#e0e0e0] p-3.5">
                <div className="border-b border-black pb-1.5 mb-2.5">
                  <h2 className="text-xs font-franklin font-bold uppercase tracking-wider text-black">
                    Permitted Instruction Subtypes
                  </h2>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowFunding}
                      onChange={(e) => setAllowFunding(e.target.checked)}
                      className="h-4 w-4 border border-black accent-black rounded-none"
                    />
                    <span className="text-xs font-franklin text-black font-semibold">
                      Inbound Funding (Fiat Wire &rarr; ADA)
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowRedemption}
                      onChange={(e) => setAllowRedemption(e.target.checked)}
                      className="h-4 w-4 border border-black accent-black rounded-none"
                    />
                    <span className="text-xs font-franklin text-black font-semibold">
                      Outbound Redemption (ADA &rarr; Fiat Wire)
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Right Column: Specimen Preview & Guarantees (5 cols) */}
            <div className="col-span-5 space-y-3.5">
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
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;compartment_id&quot;</span>: <span className="text-white">&quot;{editingItem?.accountId || 'ADA-8804-TR-AUTOGEN'}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;display_name&quot;</span>: <span className="text-white">&quot;{accountDisplayName || 'Untitled'}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;boundary_class&quot;</span>: <span className="text-[#10b981]">&quot;ISO-20022_FIAT_ONLY&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;bound_rail&quot;</span>: <span className="text-white">&quot;{selectedRail}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;min_reserve&quot;</span>: <span className="text-white">&quot;{minOperatingBalance}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;sweep_trigger&quot;</span>: <span className="text-white">&quot;{targetSweepTrigger}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;allow_funding&quot;</span>: <span className="text-[#10b981]">{allowFunding ? 'true' : 'false'}</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;allow_redemption&quot;</span>: <span className="text-[#10b981]">{allowRedemption ? 'true' : 'false'}</span></div>
                  <div><span className="text-[#888]">{'}'}</span></div>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="space-y-2 pt-1">
                <button
                  type="submit"
                  className="w-full bg-black hover:bg-[#222] text-white py-2 px-4 text-xs font-franklin font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors shadow-none"
                >
                  {editingItem ? 'Save Changes' : 'Provision ADA Account'}
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
