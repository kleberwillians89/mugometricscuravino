import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PeriodProvider } from "./app/PeriodContext";

import "./index.css"; // reset + base
import "./styles/mugo.tokens.css";
import "./styles/App.css";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PeriodProvider>
      <App />
    </PeriodProvider>
  </React.StrictMode>
);
