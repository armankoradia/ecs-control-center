import React, { useState, useEffect, useCallback } from "react";
import apiService from "../services/apiService";

function TaskDefinitionEditor({ cluster, service, region, onClose, onUpdate, onSaving }) {
  const [taskDefinition, setTaskDefinition] = useState(null);
  const [imageInfo, setImageInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [changes, setChanges] = useState({
    cpu: "",
    memory: "",
    container_updates: []
  });
  // No global wheel interception; handle on inputs only so page scroll works

  const fetchTaskDefinition = useCallback(async () => {
    if (!cluster || !service) return;

    setLoading(true);
    setError(null);
    try {
      // Fetch both task definition and image info in parallel
      const [taskDefData, imageInfoData] = await Promise.all([
        apiService.getTaskDefinition(cluster, service, region),
        apiService.getServiceImageInfo(cluster, service, region)
      ]);
      
      if (taskDefData && !taskDefData.error) {
        setTaskDefinition(taskDefData);
        setImageInfo(imageInfoData);
        
        // Create container updates with auto-populated latest images
        const container_updates = taskDefData.container_definitions.map(container => {
          // Find corresponding image info for this container
          const containerImageInfo = imageInfoData?.container_image_info?.find(
            img => img.container_name === container.name
          );
          
          
          return {
            container_name: container.name,
            cpu: container.cpu ? container.cpu.toString() : "",
            // Use memory_reservation if available, fallback to memory
            memory: container.memory_reservation ? container.memory_reservation.toString() : (container.memory ? container.memory.toString() : ""),
            // Auto-populate latest image if updates are available
            image: containerImageInfo?.has_updates ? containerImageInfo.latest_image : container.image,
            environment_variables: container.environment.reduce((acc, env) => {
              acc[env.name] = env.value;
              return acc;
            }, {}),
            secrets: container.secrets.reduce((acc, secret) => {
              acc[secret.name] = secret.valueFrom;
              return acc;
            }, {})
          };
        });
        
        setChanges({
          cpu: taskDefData.cpu ? taskDefData.cpu.toString() : "",
          memory: taskDefData.memory ? taskDefData.memory.toString() : "",
          container_updates: container_updates
        });
      } else {
        setError(taskDefData?.error || "Failed to fetch task definition");
      }
    } catch (err) {
      setError("Failed to fetch task definition: " + (err?.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  }, [cluster, service, region]);

  useEffect(() => {
    fetchTaskDefinition();
  }, [fetchTaskDefinition]);

  const handleTaskLevelChange = (field, value) => {
    setChanges(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleContainerChange = (containerIndex, field, value) => {
    setChanges(prev => ({
      ...prev,
      container_updates: prev.container_updates.map((container, index) => 
        index === containerIndex 
          ? { ...container, [field]: value }
          : container
      )
    }));
  };

  const handleEnvironmentVariableChange = (containerIndex, varName, value) => {
    setChanges(prev => ({
      ...prev,
      container_updates: prev.container_updates.map((container, index) => 
        index === containerIndex 
          ? {
              ...container,
              environment_variables: {
                ...container.environment_variables,
                [varName]: value
              }
            }
          : container
      )
    }));
  };

  const handleImageChange = (containerIndex, value) => {
    setChanges(prev => ({
      ...prev,
      container_updates: prev.container_updates.map((container, index) => 
        index === containerIndex 
          ? { ...container, image: value }
          : container
      )
    }));
  };

  const handleSecretChange = (containerIndex, secretName, value) => {
    setChanges(prev => ({
      ...prev,
      container_updates: prev.container_updates.map((container, index) => 
        index === containerIndex 
          ? {
              ...container,
              secrets: {
                ...container.secrets,
                [secretName]: value
              }
            }
          : container
      )
    }));
  };

  const handleSave = async () => {
    if (!taskDefinition) return;

    // Validate configuration before saving
    const validation = validateConfiguration();
    if (!validation.isValid) {
      setError(validation.message);
      return;
    }

    setSaving(true);
    setError(null);
    
    // Notify parent component that saving has started
    if (onSaving) {
      onSaving(true);
    }
    
    try {
      // Prepare update data
      const updateData = {
        cluster,
        service,
        // Send null if user cleared the values (to remove them from task definition)
        cpu: !changes.cpu || changes.cpu.toString().trim() === "" ? null : changes.cpu,
        memory: !changes.memory || changes.memory.toString().trim() === "" ? null : changes.memory,
        container_updates: changes.container_updates
          .filter(container => 
            (container.cpu && container.cpu.toString().trim() !== "") || 
            (container.memory && container.memory.toString().trim() !== "") || 
            (container.image && container.image.trim() !== "") ||
            Object.keys(container.environment_variables).length > 0 ||
            Object.keys(container.secrets).length > 0
          )
          .map(container => ({
            container_name: container.container_name,
            // Send null if user cleared the values (to remove them from container definition)
            cpu: !container.cpu || container.cpu.toString().trim() === "" ? null : parseInt(container.cpu),
            memory: !container.memory || container.memory.toString().trim() === "" ? null : parseInt(container.memory),
            image: container.image || null,
            environment_variables: Object.keys(container.environment_variables).length > 0 
              ? container.environment_variables 
              : null,
            secrets: Object.keys(container.secrets).length > 0 
              ? container.secrets 
              : null
          }))
      };

      const result = await apiService.updateTaskDefinition(updateData, region);
      
      if (result && !result.error) {
        // Notify parent component of successful update
        if (onUpdate) {
          onUpdate(result);
        }
        // Close the editor
        if (onClose) {
          onClose();
        }
      } else {
        setError(result?.error || "Failed to update task definition");
      }
    } catch (err) {
      setError("Failed to update task definition: " + (err?.response?.data?.detail || err.message));
    } finally {
      setSaving(false);
      // Notify parent component that saving has completed
      if (onSaving) {
        onSaving(false);
      }
    }
  };

  const validateConfiguration = () => {
    // Check if task-level CPU/Memory is specified
    const hasTaskLevelCpu = changes.cpu && changes.cpu.toString().trim() !== "";
    const hasTaskLevelMemory = changes.memory && changes.memory.toString().trim() !== "";
    
    // Check if any container has CPU/Memory specified
    const hasContainerLevelResources = changes.container_updates.some(container => 
      (container.cpu && container.cpu.toString().trim() !== "") ||
      (container.memory && container.memory.toString().trim() !== "")
    );
    
    // At least one level must have CPU/Memory specified
    const hasAnyCpuMemory = hasTaskLevelCpu || hasTaskLevelMemory || hasContainerLevelResources;
    
    return {
      isValid: hasAnyCpuMemory,
      message: hasAnyCpuMemory ? "" : "Either Task-level or Container-level CPU/Memory must be specified"
    };
  };

  const hasChanges = () => {
    if (!taskDefinition) return false;
    
    // Check task-level changes
    if (changes.cpu !== (taskDefinition.cpu || "")) return true;
    if (changes.memory !== (taskDefinition.memory || "")) return true;
    
    // Check container-level changes
    return changes.container_updates.some((container, index) => {
      const original = taskDefinition.container_definitions[index];
      const originalMemory = original?.memory_reservation || original?.memory || "";
      return (
        container.cpu !== (original?.cpu || "") ||
        container.memory !== originalMemory ||
        container.image !== (original?.image || "") ||
        Object.keys(container.environment_variables).length > 0 ||
        Object.keys(container.secrets).length > 0
      );
    });
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl w-full mx-4">
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2"></div>
            <span className="ml-2 text-gray-600">Loading task definition...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl w-full mx-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Task Definition Editor</h3>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 text-xl"
            >
              ×
            </button>
          </div>
          <div className="p-3 bg-red-50 border border-red-200 rounded">
            <div className="text-sm text-red-600">{error}</div>
          </div>
          <div className="flex justify-end mt-4">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!taskDefinition) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-5xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">
            Edit Task Definition - {service}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl"
          >
            ×
          </button>
        </div>

        <div className="space-y-6">
          {/* Task-Level Configuration */}
          <div className="border border-gray-200 rounded-lg p-5 bg-gray-50/30">
            <h4 className="text-md font-semibold text-gray-800 mb-4">⚙️ Task Configuration</h4>
            <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
              💡 <strong>Note:</strong> Either specify CPU/Memory here OR in Container Configuration below. At least one level must have resources specified.
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  CPU (units)
                </label>
                <input
                  type="number"
                  value={changes.cpu}
                  onChange={(e) => handleTaskLevelChange("cpu", e.target.value)}
                  onWheel={(e) => { e.currentTarget.blur(); }}
                  onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); } }}
                  placeholder={taskDefinition.cpu || "Not set"}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Memory (MB)
                </label>
                <input
                  type="number"
                  value={changes.memory}
                  onChange={(e) => handleTaskLevelChange("memory", e.target.value)}
                  onWheel={(e) => { e.currentTarget.blur(); }}
                  onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); } }}
                  placeholder={taskDefinition.memory || "Not set"}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>
          </div>

          {/* Container Configurations */}
          <div className="space-y-6">
            <h4 className="text-md font-semibold text-gray-800">Container Configurations</h4>
            {changes.container_updates.map((container, index) => {
              const originalContainer = taskDefinition.container_definitions[index];
              const containerImageInfo = imageInfo?.container_image_info?.find(
                img => img.container_name === container.container_name
              );
              
              
              return (
                <div key={container.container_name} className="border border-gray-200 rounded-lg p-5 bg-gray-50/30">
                  {/* Container Header */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <h5 className="text-lg font-semibold text-gray-800">
                        {container.container_name}
                      </h5>
                      {containerImageInfo?.has_updates && (
                        <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                          🔄 Update Available
                        </span>
                      )}
                    </div>
                    
                    {/* Current Image Display */}
                    <div className="bg-white border border-gray-200 rounded-md p-3">
                      <div className="text-xs font-medium text-gray-500 mb-1">Current Image:</div>
                      <div className="text-sm text-gray-700 break-all">
                        {originalContainer?.image}
                      </div>
                    </div>
                  </div>
                  
                  {/* Image Configuration */}
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      🐳 Docker Image URI
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={container.image || ""}
                        onChange={(e) => handleImageChange(index, e.target.value)}
                        placeholder="Enter Docker image URI"
                        className="w-full px-3 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white"
                      />
                      {containerImageInfo?.has_updates && (
                        <div className="absolute -top-8 right-0 text-xs text-green-600 bg-green-50 px-2 py-1 rounded border border-green-200">
                          ✨ Auto-populated with latest
                        </div>
                      )}
                    </div>
                    
                    {containerImageInfo?.has_updates && (
                      <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-md">
                        <div className="text-xs font-medium text-green-700 mb-1">Latest Available:</div>
                        <div className="text-sm text-green-800 break-all">
                          {containerImageInfo.latest_image}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Resource Configuration */}
                  <div className="mb-6">
                    <h6 className="text-sm font-semibold text-gray-700 mb-3">⚙️ Container Resource Configuration</h6>
                    <div className="mb-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-700">
                      💡 <strong>Note:</strong> If Task-level CPU/Memory is empty, specify CPU and Memory Reservation here. If Task-level has values, these are optional.
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-2">
                          💻 CPU (units)
                        </label>
                        <input
                          type="number"
                          value={container.cpu}
                          onChange={(e) => handleContainerChange(index, "cpu", e.target.value)}
                          onWheel={(e) => { e.currentTarget.blur(); }}
                          onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); } }}
                          placeholder={originalContainer?.cpu || "Not set"}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-2">
                          🧠 Memory Reservation (MB)
                        </label>
                        <input
                          type="number"
                          value={container.memory}
                          onChange={(e) => handleContainerChange(index, "memory", e.target.value)}
                          onWheel={(e) => { e.currentTarget.blur(); }}
                          onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); } }}
                          placeholder={originalContainer?.memory_reservation || originalContainer?.memory || "Not set"}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Environment Variables */}
                  <div className="mb-6">
                    <h6 className="text-sm font-semibold text-gray-700 mb-3">
                      🌍 Environment Variables
                      {Object.keys(container.environment_variables).length > 0 && (
                        <span className="ml-2 text-xs text-blue-600 font-normal">
                          ({Object.keys(container.environment_variables).length} existing)
                        </span>
                      )}
                    </h6>
                    <div className="space-y-2">
                      {Object.entries(container.environment_variables).map(([name, value]) => (
                        <div key={name} className="flex space-x-2">
                          <input
                            type="text"
                            value={name}
                            readOnly
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50"
                          />
                          <input
                            type="text"
                            value={value}
                            onChange={(e) => handleEnvironmentVariableChange(index, name, e.target.value)}
                            className="flex-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            onClick={() => {
                              const newEnvVars = { ...container.environment_variables };
                              delete newEnvVars[name];
                              handleContainerChange(index, "environment_variables", newEnvVars);
                            }}
                            className="px-3 py-2 bg-red-100 text-red-600 rounded hover:bg-red-200 transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          const varName = prompt("Enter environment variable name:");
                          if (varName) {
                            handleEnvironmentVariableChange(index, varName, "");
                          }
                        }}
                        className="px-3 py-2 bg-blue-100 text-blue-600 rounded hover:bg-blue-200 transition-colors text-sm"
                      >
                        + Add Environment Variable
                      </button>
                    </div>
                  </div>

                  {/* Secrets */}
                  <div>
                    <h6 className="text-sm font-semibold text-gray-700 mb-3">
                      🔐 Secrets
                      {Object.keys(container.secrets).length > 0 && (
                        <span className="ml-2 text-xs text-blue-600 font-normal">
                          ({Object.keys(container.secrets).length} existing)
                        </span>
                      )}
                    </h6>
                    <div className="space-y-2">
                      {Object.entries(container.secrets).map(([name, value]) => (
                        <div key={name} className="flex space-x-2">
                          <input
                            type="text"
                            value={name}
                            readOnly
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50"
                          />
                          <input
                            type="text"
                            value={value}
                            onChange={(e) => handleSecretChange(index, name, e.target.value)}
                            placeholder="arn:aws:secretsmanager:region:account:secret:name"
                            className="flex-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            onClick={() => {
                              const newSecrets = { ...container.secrets };
                              delete newSecrets[name];
                              handleContainerChange(index, "secrets", newSecrets);
                            }}
                            className="px-3 py-2 bg-red-100 text-red-600 rounded hover:bg-red-200 transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          const secretName = prompt("Enter secret name:");
                          if (secretName) {
                            handleSecretChange(index, secretName, "");
                          }
                        }}
                        className="px-3 py-2 bg-blue-100 text-blue-600 rounded hover:bg-blue-200 transition-colors text-sm"
                      >
                        + Add Secret
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges() || saving || !validateConfiguration().isValid}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Deploying..." : "🚀 Update & Deploy"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TaskDefinitionEditor;
