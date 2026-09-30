"use client";

import { useState, useEffect, useMemo } from "react";
import Table from "@/components/Table";
import SectionStats from "@/components/SectionStats";
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { generateCode } from "@/lib/helpers";
import toast from "react-hot-toast";
import { Plus, ArrowLeft, Users, CheckCircle, Globe2, MapPin } from "lucide-react";

export default function ClientsSection({ canWrite = true }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    city: "",
    country: "",
    notes: "",
  });

  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, "clients"),
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => (a.code || "").localeCompare(b.code || ""));
        setClients(data);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        toast.error("Failed to load clients");
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const openAdd = () => {
    if (!canWrite) return;
    setEditing(null);
    setForm({ name: "", phone: "", email: "", city: "", country: "", notes: "" });
    setShowModal(true);
  };

  const openEdit = (row) => {
    if (!canWrite) return;
    setEditing(row);
    setForm({
      name: row.name || "",
      phone: row.phone || "",
      email: row.email || "",
      city: row.city || "",
      country: row.country || "",
      notes: row.notes || "",
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await updateDoc(doc(db, "clients", editing.id), {
          ...form,
          updatedAt: serverTimestamp(),
        });
        toast.success("Client updated");
      } else {
        const code = await generateCode("clients");
        await addDoc(collection(db, "clients"), {
          ...form,
          code,
          status: "Active",
          createdAt: serverTimestamp(),
        });
        toast.success("Client added");
      }
      setShowModal(false);
      // onSnapshot will auto-update the list — no manual refetch needed
    } catch (error) {
      console.error(error);
      toast.error("Operation failed");
    }
  };

  const handleDelete = async (row) => {
    if (!canWrite) return;
    if (!confirm("Are you sure you want to delete this item?")) return;
    try {
      await deleteDoc(doc(db, "clients", row.id));
      toast.success("Client deleted");
    } catch (error) {
      console.error(error);
      toast.error("Delete failed");
    }
  };

  const columns = [
    { key: "code", label: "Client Code" },
    { key: "name", label: "Full Name" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "city", label: "City" },
    { key: "country", label: "Country" },
    {
      key: "status",
      label: "Status",
      render: (val) => (
        <span className={`badge ${val === "Active" ? "badge-green" : "badge-gray"}`}>
          {val || "Active"}
        </span>
      ),
    },
  ];

  // Section header dashboard — Total / Active / Countries / Cities covered
  // across every client currently loaded.
  const sectionStats = useMemo(() => {
    const total = clients.length;
    const active = clients.filter((c) => (c.status || "Active") === "Active").length;
    const countries = new Set(clients.map((c) => (c.country || "").trim()).filter(Boolean)).size;
    const cities = new Set(clients.map((c) => (c.city || "").trim()).filter(Boolean)).size;
    return [
      { label: "Total Clients", value: total.toLocaleString("en-US"), icon: Users, color: "bg-blue-500" },
      { label: "Active", value: active.toLocaleString("en-US"), icon: CheckCircle, color: "bg-emerald-600" },
      { label: "Countries", value: countries.toLocaleString("en-US"), icon: Globe2, color: "bg-purple-500" },
      { label: "Cities", value: cities.toLocaleString("en-US"), icon: MapPin, color: "bg-indigo-500" },
    ];
  }, [clients]);

  if (showModal && canWrite) {
    return (
      <div>
        <div className="px-6 pt-4 pb-3 flex items-center gap-3 border-b border-gray-200">
          <button
            onClick={() => setShowModal(false)}
            className="p-2 -ml-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
            title="Back to list"
          >
            <ArrowLeft size={18} />
          </button>
          <h3 className="font-semibold text-lg">{editing ? "Edit Client" : "Add Client"}</h3>
        </div>

        <form onSubmit={handleSubmit} className="p-6 max-w-2xl space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{"Full Name"}</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{"Phone"}</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{"Email"}</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{"City"}</label>
              <input
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{"Country"}</label>
              <input
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{"Notes"}</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
            >
              {"Cancel"}
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
            >
              {"Save"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div>
      <SectionStats stats={sectionStats} />

      <div className="p-6">
        <div className="flex items-center justify-between mb-5">
          <p className="text-sm text-gray-500">
            {clients.length} {"Clients".toLowerCase()}
          </p>
          {canWrite && (
            <button
              onClick={openAdd}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
            >
              <Plus size={18} />
              {"Add Client"}
            </button>
          )}
        </div>

        <Table
          columns={columns}
          data={clients}
          loading={loading}
          onEdit={canWrite ? openEdit : undefined}
          onDelete={canWrite ? handleDelete : undefined}
        />
      </div>
    </div>
  );
}
