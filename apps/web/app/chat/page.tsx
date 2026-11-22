"use client";

import { useState } from "react";
import { ArrowLeft, MessageCircle, Search, Send, UserPlus } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { ScreenHeader } from "@/components/shell/ScreenHeader";

export default function ChatPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("Maya Chen");
  const [message, setMessage] = useState("");
  const [contacts, setContacts] = useState([
    { name: "Maya Chen", handle: "@mayamoves", status: "Tempo run · 8.4 km" },
    { name: "Jordan Patel", handle: "@jordanp", status: "Upper body · 42 min ago" },
  ]);
  const [messages, setMessages] = useState([
    { author: "Maya", body: "That tempo run looked strong. Nice pacing.", time: "09:42" },
    { author: "You", body: "Thanks. Recovery score was good today.", time: "09:44" },
  ]);

  function sendMessage() {
    const trimmed = message.trim();
    if (!trimmed) return;
    setMessages((current) => [...current, { author: "You", body: trimmed, time: "now" }]);
    setMessage("");
  }

  function addContact() {
    const trimmed = search.trim();
    if (!trimmed) return;
    const newContact = { name: trimmed, handle: `@${trimmed.toLowerCase().replace(/\s+/g, "")}`, status: "New FITOS connection" };
    setContacts((current) => [newContact, ...current]);
    setSelected(trimmed);
    setSearch("");
  }

  return (
    <>
      <div className="mb-4">
        <Link href="/profile" className="inline-flex items-center gap-2 text-sm text-slate-400"><ArrowLeft size={16} /> Profile</Link>
      </div>
      <ScreenHeader eyebrow="Messages" title="Friends who train" subtitle="Find people on FITOS and share your next update." />
      <div className="space-y-4">
        <div className="flex gap-2 rounded-2xl border border-white/10 bg-slate-900/80 p-2">
          <Search className="m-2 text-slate-500" size={18} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addContact()} placeholder="Search username or name" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600" />
          <Button variant="secondary" aria-label="Add user" onClick={addContact}><UserPlus size={16} /></Button>
        </div>

        {search ? <div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/5 p-3 text-sm text-slate-300">Search result ready: <strong className="text-white">{search}</strong><span className="ml-2 text-emerald-300">Press Enter to start chat</span></div> : null}

        <div className="grid gap-2">
          {contacts.map((contact) => (
            <button key={contact.handle} onClick={() => setSelected(contact.name)} className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${selected === contact.name ? "border-emerald-300/30 bg-emerald-300/10" : "border-white/10 bg-slate-900/70 hover:border-white/20"}`}>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold text-emerald-200">{contact.name.split(" ").map((part) => part[0]).join("")}</span>
              <span className="min-w-0 flex-1"><strong className="block text-sm text-white">{contact.name}</strong><span className="block text-xs text-slate-500">{contact.handle} · {contact.status}</span></span>
              <MessageCircle size={16} className="text-slate-500" />
            </button>
          ))}
        </div>

        <div className="flex min-h-[40vh] flex-col rounded-3xl border border-white/10 bg-slate-900/80 p-4">
          <div className="mb-4 flex items-center gap-3 border-b border-white/10 pb-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-semibold text-emerald-200">{selected.split(" ").map((part) => part[0]).join("")}</span><div><p className="font-semibold text-white">{selected}</p><p className="text-xs text-slate-500">Private conversation</p></div></div>
          <div className="flex-1 space-y-3">
            {messages.map((item, index) => (
              <div key={`${item.time}-${index}`} className={item.author === "You" ? "ml-8 rounded-2xl bg-emerald-400/15 p-3" : "mr-8 rounded-2xl bg-slate-800 p-3"}>
                <div className="flex items-center justify-between gap-3 text-xs text-slate-500"><span>{item.author}</span><span>{item.time}</span></div>
                <p className="mt-1 text-sm leading-6 text-slate-200">{item.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <input value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => event.key === "Enter" && sendMessage()} placeholder={`Message ${selected}`} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-emerald-300/40" />
            <Button aria-label="Send message" onClick={sendMessage}><Send size={16} /></Button>
          </div>
        </div>
      </div>
    </>
  );
}
