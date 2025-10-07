// frontend/src/components/ContainerPanel.js
import React, { useState, useEffect } from "react";
import LogsPanel from "./LogsPanel";

export default function ContainerPanel({ cluster, service, auth }) {
  const [containers, setContainers] = useState([]);

  useEffect(() => {
    async function fetchContainers() {
      if (!cluster || !service) return;
      try {
        // Fetch service details and task definition from backend
        const resp = await fetch(`http://localhost:8000/clusters/${cluster}/services`);
        // For simplicity, using dummy containers
        setContainers([
          { name: "container-1", cpu: 256, memory: 512, image: "nginx", entrypoint: ["/bin/sh"], command: ["-c", "nginx -g 'daemon off;'"], logGroup: "/ecs/demo", logStream: "stream1" },
          { name: "container-2", cpu: 128, memory: 256, image: "busybox", entrypoint: ["/bin/sh"], command: ["-c", "echo hello"], logGroup: "/ecs/demo", logStream: "stream2" }
        ]);
      } catch (err) {
        console.error(err);
      }
    }
    fetchContainers();
  }, [cluster, service]);

  return (
    <div className="space-y-6">
      {containers.map((c) => (
        <div key={c.name} className="bg-white shadow rounded p-4 grid grid-cols-2 gap-4">
          {/* Container Info */}
          <div>
            <h3 className="text-lg font-bold mb-2">{c.name}</h3>
            <table className="table-auto">
              <tbody>
                <tr><td className="font-semibold pr-2">Image:</td><td>{c.image}</td></tr>
                <tr><td className="font-semibold pr-2">CPU:</td><td>{c.cpu}</td></tr>
                <tr><td className="font-semibold pr-2">Memory:</td><td>{c.memory}</td></tr>
                <tr><td className="font-semibold pr-2">Entrypoint:</td><td>{c.entrypoint.join(" ")}</td></tr>
                <tr><td className="font-semibold pr-2">Command:</td><td>{c.command.join(" ")}</td></tr>
              </tbody>
            </table>
          </div>

          {/* Logs Panel */}
          <div>
            <LogsPanel logGroup={c.logGroup} logStream={c.logStream} profile={auth.profile} />
          </div>
        </div>
      ))}
    </div>
  );
}

