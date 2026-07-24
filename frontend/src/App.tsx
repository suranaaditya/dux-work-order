import { Routes, Route, Navigate } from "react-router-dom";
import { Shell } from "./components/Shell";
import Dashboard from "./pages/Dashboard";
import WorkOrders from "./pages/WorkOrders";
import WorkOrderDetail from "./pages/WorkOrderDetail";
import NewWorkOrder from "./pages/NewWorkOrder";
import RABills from "./pages/RABills";
import RABillDetail from "./pages/RABillDetail";
import NewRABill from "./pages/NewRABill";
import Soon from "./pages/Soon";

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/work-orders" element={<WorkOrders />} />
        <Route path="/work-orders/new" element={<NewWorkOrder />} />
        <Route path="/work-orders/:name" element={<WorkOrderDetail />} />
        <Route path="/ra-bills" element={<RABills />} />
        <Route path="/ra-bills/new" element={<NewRABill />} />
        <Route path="/ra-bills/:name" element={<RABillDetail />} />
        <Route path="/suppliers" element={<Soon title="Suppliers" />} />
        <Route path="/measurement-book" element={<Soon title="Measurement Book" />} />
        <Route path="/payments" element={<Soon title="Payments" />} />
        <Route path="/reports" element={<Soon title="Reports" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
