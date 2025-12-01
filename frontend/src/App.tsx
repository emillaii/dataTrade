import { useState } from "react";
import { AuthPage } from "./components/AuthPage";
import { LeftSidebar } from "./components/LeftSidebar";
import { Navigation } from "./components/Navigation";
import { DataSync } from "./components/DataSync";
import { DatasetBrowser } from "./components/DatasetBrowser";
import { Simulation } from "./components/Simulation";
import { Analytics } from "./components/Analytics";
import { PlaybackChart } from "./components/PlaybackChart";
import { IndicatorLab } from "./components/IndicatorLab";
import { Dataset } from "./types/market";
import type { IndicatorSpec } from "./types/indicator";
import "./styles/globals.css";

type Section = "data-sync" | "datasets" | "simulation" | "analytics" | "indicators" | "strategies" | "reports";

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentSection, setCurrentSection] = useState<Section>("data-sync");
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [initialIndicators, setInitialIndicators] = useState<IndicatorSpec[]>([]);
  const [isPlaybackView, setIsPlaybackView] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const handleLogin = () => {
    setIsAuthenticated(true);
  };

  const handleOpenDataset = (dataset: Dataset) => {
    setSelectedDataset(dataset);
    setInitialIndicators([]);
    setIsPlaybackView(true);
    setIsSidebarOpen(false);
  };

  const handleBackToBrowser = () => {
    setIsPlaybackView(false);
    setSelectedDataset(null);
    setInitialIndicators([]);
  };

  const handleStartSimulation = (dataset: Dataset, indicators: IndicatorSpec[]) => {
    setSelectedDataset(dataset);
    setInitialIndicators(indicators);
    setIsPlaybackView(true);
  };

  const handleSectionChange = (section: string) => {
    setCurrentSection(section as Section);
    setIsPlaybackView(false);
    setSelectedDataset(null);
    setIsSidebarOpen(false);
  };

  const getSectionTitle = () => {
    switch (currentSection) {
      case "data-sync":
        return "Data Sync";
      case "datasets":
        return "Datasets";
      case "simulation":
        return "Simulation";
      case "analytics":
        return "Analytics";
      case "indicators":
        return "Indicators";
      case "strategies":
        return "Strategies";
      case "reports":
        return "Reports";
      default:
        return "Dashboard";
    }
  };

  if (!isAuthenticated) {
    return <AuthPage onLogin={handleLogin} />;
  }

  if (isPlaybackView && selectedDataset) {
    return (
      <PlaybackChart
        dataset={selectedDataset}
        initialIndicators={initialIndicators}
        onBack={handleBackToBrowser}
      />
    );
  }

  return (
    <div className="h-screen bg-[var(--bg-app)] flex flex-col">
      <Navigation
        title={getSectionTitle()}
        breadcrumb={getSectionTitle()}
        onMenuToggle={() => setIsSidebarOpen((open) => !open)}
        isMenuOpen={isSidebarOpen}
      />
      
      <div className="flex-1 flex overflow-hidden relative">
        <LeftSidebar
          currentSection={currentSection}
          onSectionChange={handleSectionChange}
          isMobileOpen={isSidebarOpen}
          onCloseMobile={() => setIsSidebarOpen(false)}
        />
        {isSidebarOpen && (
          <button
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden"
            aria-label="Close navigation"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
        
        {currentSection === "data-sync" && <DataSync />}
        {currentSection === "datasets" && <DatasetBrowser onOpenDataset={handleOpenDataset} />}
        {currentSection === "simulation" && <Simulation onStartSimulation={handleStartSimulation} />}
        {currentSection === "analytics" && <Analytics />}
        {currentSection === "indicators" && <IndicatorLab />}
        {currentSection === "strategies" && (
          <div className="flex-1 p-6 space-y-6 overflow-auto">
            <div>
              <h1 className="text-2xl text-[var(--text-primary)] mb-2">Strategies</h1>
              <p className="text-sm text-[var(--text-secondary)]">
                Manage your trading strategies
              </p>
            </div>
            <div className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] shadow-lg p-12 flex flex-col items-center justify-center min-h-[500px]">
              <h3 className="text-xl text-[var(--text-primary)] mb-2">Strategies</h3>
              <p className="text-[var(--text-muted)] text-center max-w-md">
                Coming soon: Strategy builder and management tools.
              </p>
            </div>
          </div>
        )}
        {currentSection === "reports" && (
          <div className="flex-1 p-6 space-y-6 overflow-auto">
            <div>
              <h1 className="text-2xl text-[var(--text-primary)] mb-2">Reports</h1>
              <p className="text-sm text-[var(--text-secondary)]">
                View and export performance reports
              </p>
            </div>
            <div className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] shadow-lg p-12 flex flex-col items-center justify-center min-h-[500px]">
              <h3 className="text-xl text-[var(--text-primary)] mb-2">Reports</h3>
              <p className="text-[var(--text-muted)] text-center max-w-md">
                Coming soon: Comprehensive reporting and export functionality.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
