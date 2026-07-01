import React, { useState, useEffect, useRef } from 'react';
import { CanvasNode, CustomApiConfig } from '../types';
import ImageGeneratorNode from './flow/ImageGeneratorNode';
import VideoGeneratorNode from './flow/VideoGeneratorNode';
import ShotNode from './flow/ShotNode';
import Scene3DNode from './flow/Scene3DNode';

interface CanvasProps {
  activeNode: string;
  nodes: CanvasNode[];
  onUpdateNodes: (n: CanvasNode[] | ((prev: CanvasNode[]) => CanvasNode[])) => void;
  currentUserRole?: 'ADMIN' | 'DEVELOPER' | 'USER';
  currentProjectId?: string | null;
  apiConfigs?: CustomApiConfig[];
}

export function formatShotRootName(index: number): string {
  const group = Math.floor(index / 9) + 1;
  const order = (index % 9) + 1;
  return `${group}-${order}`;
}

export function isRootShotNode(node: CanvasNode): boolean {
  return node.type === '镜头' && !node.parentId;
}

export function renumberRootShotNodes(nodes: CanvasNode[]): CanvasNode[] {
  let rootShotIndex = 0;
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (!isRootShotNode(node)) return node;
    const nextName = formatShotRootName(rootShotIndex);
    rootShotIndex += 1;
    if (node.name === nextName) return node;
    changed = true;
    return { ...node, name: nextName };
  });
  return changed ? nextNodes : nodes;
}

function assistantNodeDefaults(node: Partial<CanvasNode>, activeNode: string, x: number, y: number): CanvasNode {
  const timestamp = Date.now();
  const type = node.type || (activeNode === '05' ? '镜头' : '角色');
  const isArtAsset = ['角色', '场景', '道具', '氛围', '图片生成'].includes(type);
  const isVideoAsset = type === '视频生成';
  return {
    id: `node_ai_${timestamp}_${Math.random().toString(16).slice(2)}`,
    name: node.name || (type === '镜头' ? 'AI 镜头节点' : `AI ${type}节点`),
    type,
    x,
    y,
    parentId: node.parentId ?? null,
    collapsed: false,
    status: node.status || '草稿',
    prompt: node.prompt || '',
    ...(isArtAsset ? {
      model: '',
      use_custom_api: false,
      generated_media: '',
      aspect_ratio: node.aspect_ratio || '1:1',
      width: node.width || 1024,
      height: node.height || 1024,
      resolution: node.resolution || '1K',
      num_outputs: node.num_outputs || 1,
      style_preset: node.style_preset || 'photorealistic',
      negative_prompt: node.negative_prompt || 'blurry, low quality, distorted anatomy, text defects',
      cfg_scale: node.cfg_scale || 7.5,
      steps: node.steps || 25,
      seed: node.seed ?? -1
    } : {}),
    ...(isVideoAsset ? {
      model: '',
      use_custom_api: false,
      generated_media: '',
      aspect_ratio: node.aspect_ratio || '16:9',
      video_resolution: node.video_resolution || '720P',
      video_duration: node.video_duration || 5,
      generate_audio: node.generate_audio ?? true,
      video_generation_mode: node.video_generation_mode || 'text_to_video'
    } : {}),
    ...node
  };
}

export default function Canvas({ activeNode, nodes, onUpdateNodes, currentUserRole, currentProjectId, apiConfigs = [] }: CanvasProps) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 100, y: 150 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  
  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; dropX: number; dropY: number } | null>(null);

  // Plus menu for spawning custom child nodes
  const [plusMenu, setPlusMenu] = useState<{ parentId: string; x: number; y: number } | null>(null);

  const [nodeToCenter, setNodeToCenter] = useState<string | null>(null);
  const [isAnimatingPan, setIsAnimatingPan] = useState(false);
  const shouldRenumberShotRoots = activeNode === '04' || activeNode === '05';
  const normalizeShotRootNames = (nextNodes: CanvasNode[]) =>
    shouldRenumberShotRoots ? renumberRootShotNodes(nextNodes) : nextNodes;
  const removeNodeAndRenumberIfNeeded = (prevNodes: CanvasNode[], nodeId: string) => {
    const removedNode = prevNodes.find(n => n.id === nodeId);
    const nextNodes = prevNodes.filter(n => n.id !== nodeId && n.parentId !== nodeId);
    return shouldRenumberShotRoots && removedNode && isRootShotNode(removedNode)
      ? renumberRootShotNodes(nextNodes)
      : nextNodes;
  };

  useEffect(() => {
    const onAssistantConfirmed = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const expectedStage = activeNode === '04' ? 'ART_03' : activeNode === '05' ? 'SHOT_04' : null;
      if (!expectedStage || detail.stage !== expectedStage) return;
      const patch = detail.action?.executionResult?.patch || {};
      const nodePatch = {
        ...(patch.node || {}),
        ...(patch.startGeneration ? {
          progress: 0,
          status: '待生成',
          statusMessage: 'AI 助手已确认，将自动启动生成任务。',
          assistant_auto_run_requested_at: new Date().toISOString(),
          assistant_auto_run_action_id: detail.action?.id || undefined
        } : {})
      };
      if (patch.mode === 'update-node' && patch.targetId) {
        onUpdateNodes((prevNodes) => prevNodes.map((node) => (
          node.id === patch.targetId
            ? { ...node, ...nodePatch, prompt: nodePatch.prompt ?? node.prompt }
            : node
        )));
        setSelectedNodeId(patch.targetId);
        setNodeToCenter(patch.targetId);
        return;
      }
      const offset = nodes.length * 26;
      const newNode = assistantNodeDefaults(nodePatch, activeNode, 140 + offset, 140 + offset);
      onUpdateNodes((prevNodes) => normalizeShotRootNames([...prevNodes, newNode]));
      setSelectedNodeId(newNode.id);
      setNodeToCenter(newNode.id);
    };
    window.addEventListener('jiying:pipeline-assistant-action-confirmed', onAssistantConfirmed);
    return () => window.removeEventListener('jiying:pipeline-assistant-action-confirmed', onAssistantConfirmed);
  }, [activeNode, nodes.length, onUpdateNodes, shouldRenumberShotRoots]);

  useEffect(() => {
    if (nodeToCenter) {
      setTimeout(() => {
        const el = document.getElementById(`node-box-${nodeToCenter}`);
        if (el && viewportRef.current) {
          const rect = el.getBoundingClientRect();
          const viewportRect = viewportRef.current.getBoundingClientRect();
          
          const screenCenterX = viewportRect.left + viewportRect.width / 2;
          const screenCenterY = viewportRect.top + viewportRect.height / 2;
          
          const elCenterX = rect.left + rect.width / 2;
          const elCenterY = rect.top + rect.height / 2;
          
          const dx = screenCenterX - elCenterX;
          const dy = screenCenterY - elCenterY;
          
          if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
            setIsAnimatingPan(true);
            setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
            setTimeout(() => {
              setIsAnimatingPan(false);
            }, 600);
          }
        }
        setNodeToCenter(null);
      }, 50);
    }
  }, [nodeToCenter]);

  // Backspace/Delete key listener to delete selected node
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedNodeId) {
        // Prevent default browser behavior (like navigating back in older browsers)
        e.preventDefault();
        onUpdateNodes((prevNodes) => removeNodeAndRenumberIfNeeded(prevNodes, selectedNodeId));
        setSelectedNodeId(null);
        recalculatePaths();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedNodeId, nodes, onUpdateNodes, shouldRenumberShotRoots]);

  // References for drag/pan
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startDragOffset = useRef({ x: 0, y: 0 });

  // Update SVG connections dynamically
  const [paths, setPaths] = useState<Array<{ d: string; active: boolean }>>([]);

  const recalculatePaths = () => {
    if (!contentRef.current) return;
    const contentRect = contentRef.current.getBoundingClientRect();
    const newPaths: Array<{ d: string; active: boolean }> = [];

    nodes.forEach(node => {
      if (node.parentId) {
        const parentEl = document.getElementById(`node-box-${node.parentId}`);
        const childEl = document.getElementById(`node-box-${node.id}`);

        if (parentEl && childEl) {
          const pRect = parentEl.getBoundingClientRect();
          const cRect = childEl.getBoundingClientRect();

          // Scale independent coordinates relative to canvas-content container
          const startX = (pRect.right - contentRect.left) / scale;
          const startY = (pRect.top + pRect.height / 2 - contentRect.top) / scale;
          const endX = (cRect.left - contentRect.left) / scale;
          const endY = (cRect.top + cRect.height / 2 - contentRect.top) / scale;

          const ctrlX1 = startX + 60;
          const ctrlX2 = endX - 60;

          const isActive = selectedNodeId === node.id || selectedNodeId === node.parentId;
          const d = `M ${startX} ${startY} C ${ctrlX1} ${startY}, ${ctrlX2} ${endY}, ${endX} ${endY}`;
          newPaths.push({ d, active: isActive });
        }
      }
    });

    setPaths(newPaths);
  };

  useEffect(() => {
    recalculatePaths();
    // Periodically update to catch rendering alignment
    const timer = setInterval(recalculatePaths, 300);
    return () => clearInterval(timer);
  }, [nodes, scale, pan, selectedNodeId]);

  // Viewport Event Listeners for Drag-Panning & Wheel/Pinch Zooming
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const isPinch = e.ctrlKey;
      const isMouseWheel = e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50;

      setIsAnimatingPan(false);

      if (isPinch || isMouseWheel) {
        // Zooming behavior
        const zoomDelta = isPinch ? -e.deltaY * 0.015 : (e.deltaY < 0 ? 1 : -1) * 0.1;
        const nextScale = Math.min(Math.max(0.2, scale * Math.exp(zoomDelta)), 3);

        setPan(prev => ({
          x: mouseX - (mouseX - prev.x) * (nextScale / scale),
          y: mouseY - (mouseY - prev.y) * (nextScale / scale)
        }));
        setScale(nextScale);
      } else {
        // Trackpad panning behavior
        setPan(prev => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY
        }));
      }
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      viewport.removeEventListener('wheel', handleWheel);
    };
  }, [scale]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 0) {
      // Middle or left click dragging
      if (e.button === 0 && ((e.target as HTMLElement).closest('.node-box') || (e.target as HTMLElement).closest('.settings-portal'))) {
        return; // Don't drag whiteboard when grabbing a node box or clicking portal settings
      }
      isDragging.current = true;
      setIsAnimatingPan(false);
      startDragOffset.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      viewportRef.current!.style.cursor = 'grabbing';
      setContextMenu(null);
      setPlusMenu(null);
      setSelectedNodeId(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    setPan({
      x: e.clientX - startDragOffset.current.x,
      y: e.clientY - startDragOffset.current.y
    });
  };

  const handleMouseUp = () => {
    isDragging.current = false;
    if (viewportRef.current) {
      viewportRef.current.style.cursor = 'move';
    }
  };

  const handleViewportDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.node-box')) return; // Avoid node boxes double clicks

    const rect = viewportRef.current!.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Convert screen coordinate to relative scale-adjusted coordinate on whiteboard
    const relativeX = (mouseX - pan.x) / scale;
    const relativeY = (mouseY - pan.y) / scale;

    setContextMenu({
      x: mouseX,
      y: mouseY,
      dropX: relativeX,
      dropY: relativeY
    });
    setPlusMenu(null);
  };

  // Node operations
  const registerNewNodeFromMenu = (type: string) => {
    if (!contextMenu) return;
    
    const timestamp = Date.now();
    const isImageNode = ['图片生成', '角色', '场景', '道具', '氛围'].includes(type);
    const isScene3DNode = type === '3D导演台';
    const isGenNode = isImageNode || type === '视频生成';
    
    if (isGenNode && (activeNode === '04' || activeNode === '05')) {
       // Automatic Pair creation: Shot Node -> Gen Node
       const shotNodeId = `node_shot_${timestamp}`;
       const genNodeId = `node_gen_${timestamp}`;

       const shotNode: CanvasNode = {
         id: shotNodeId,
         name: '',
         type: '镜头',
         x: contextMenu.dropX,
         y: contextMenu.dropY,
         parentId: null,
         collapsed: false,
         status: '草稿',
         prompt: '默认机位运动轨迹：推进'
       };

       let nodeName = `${type}生成节点`;
       if (type === '图片生成') nodeName = '生图节点';
       else if (type === '视频生成') nodeName = '生视频节点';

       let extraFields: Partial<CanvasNode> = {};
       if (['图片生成', '角色', '场景', '道具', '氛围'].includes(type)) {
         extraFields = {
           model: '',
           prompt: 'a cinematic shot of a cybernetic warrior overlooking a neon cityscape, retro lights, 8k resolution, photorealistic',
           use_custom_api: false,
           generated_media: '',
           aspect_ratio: '1:1',
           resolution: '1K',
           status: '草稿',
         };
       } else {
         extraFields = {
           model: '',
           prompt: 'futuristic flying vehicle traveling down a wet alleyway in neon drizzle, atmospheric camera cinematic tracking',
           use_custom_api: false,
           generated_media: '',
           status: '草稿',
         };
       }

       const genNode: CanvasNode = {
         id: genNodeId,
         name: nodeName,
         type,
         x: contextMenu.dropX + 450,
         y: contextMenu.dropY,
         parentId: shotNodeId,
         collapsed: false,
         ...extraFields
       };

       onUpdateNodes((prevNodes) => normalizeShotRootNames([...prevNodes, shotNode, genNode]));
       setSelectedNodeId(genNodeId);
       setNodeToCenter(genNodeId);
       setContextMenu(null);
       return;
    }

    let extraFields: Partial<CanvasNode> = {};
    if (['图片生成', '角色', '场景', '道具', '氛围'].includes(type)) {
      extraFields = {
        model: '',
        prompt: 'a cinematic shot of a cybernetic warrior overlooking a neon cityscape, retro lights, 8k resolution, photorealistic',
        use_custom_api: false,
        generated_media: '',
        aspect_ratio: '1:1',
        width: 1024,
        height: 1024,
        num_outputs: 1,
        style_preset: 'photorealistic',
        negative_prompt: 'blurry, low quality, distorted anatomy, text defects, worst quality, digital art, sketch',
        cfg_scale: 7.5,
        steps: 25,
        seed: -1,
      };
    } else if (type === '视频生成') {
      extraFields = {
        model: '',
        prompt: 'futuristic flying vehicle traveling down a wet alleyway in neon drizzle, atmospheric camera cinematic tracking',
        use_custom_api: false,
        generated_media: ''
      };
    } else if (isScene3DNode) {
      extraFields = {
        status: '草稿',
        aspect_ratio: '16:9',
        generated_media: ''
      };
    }

    let nodeName = `${type}视窗`;
    if (type === '图片生成') nodeName = '生图节点';
    else if (type === '视频生成') nodeName = '生视频节点';
    else if (isScene3DNode) nodeName = '3D导演台';
    else if (['角色', '场景', '道具', '氛围'].includes(type)) {
      nodeName = `${type}生成节点`;
    }

    const newNode: CanvasNode = {
      id: `node_custom_${Date.now()}`,
      name: nodeName,
      type,
      x: contextMenu.dropX,
      y: contextMenu.dropY,
      parentId: null,
      collapsed: false,
      ...extraFields
    };
    onUpdateNodes((prevNodes) => [...prevNodes, newNode]);
    setSelectedNodeId(newNode.id);
    setNodeToCenter(newNode.id);
    setContextMenu(null);
  };

  const handlePlusClick = (parentId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setPlusMenu({
      parentId,
      x,
      y
    });
  };

  const chooseAndSpawnChildNode = (parentId: string, category: string) => {
    const parentNode = nodes.find(n => n.id === parentId);
    if (!parentNode) return;

    let childType = category;
    let childName = `${category}衍生节点`;
    let extraFields: Partial<CanvasNode> = {};

    if (['图片生成', '角色', '场景', '道具', '氛围'].includes(category)) {
      childType = category;
      if (category === '图片生成') childName = '生图节点';
      else childName = `${category}生成节点`;
      extraFields = {
        model: '',
        prompt: 'photorealistic detail enhancement, volumetric shadows, cinematic light, award-winning composition',
        use_custom_api: false,
        generated_media: '',
        aspect_ratio: '1:1',
        width: 1024,
        height: 1024,
        num_outputs: 1,
        style_preset: 'photorealistic',
        negative_prompt: 'blurry, low quality, distorted anatomy, text defects, worst quality, digital art, sketch',
        cfg_scale: 7.5,
        steps: 25,
        seed: -1,
      };
    } else if (category === '视频生成') {
      childType = '视频生成';
      childName = '生视频节点';
      extraFields = {
        model: '',
        prompt: 'cinematic lighting transition, panning movement following the subject smoothly, extreme realistic detail, 4k resolution',
        use_custom_api: false,
        generated_media: ''
      };
    } else if (category === '3D导演台') {
      childType = '3D导演台';
      childName = '3D导演台';
      extraFields = {
        status: '草稿',
        aspect_ratio: '16:9',
        generated_media: ''
      };
    }

    const childNode: CanvasNode = {
      id: `node_child_${Date.now()}`,
      name: (activeNode === '05' || ['角色', '场景', '道具', '氛围'].includes(category)) ? childName : `${category}衍生视窗`,
      type: childType,
      x: parentNode.x + 480,
      y: parentNode.y,
      parentId,
      collapsed: false,
      status: '草稿',
      prompt: activeNode === '05' 
        ? (extraFields.prompt || '') 
        : 'battle-damaged metallic chassis, muddy mud stains on silver faceplates',
      ...extraFields
    };

    onUpdateNodes((prevNodes) => [...prevNodes, childNode]);
    setSelectedNodeId(childNode.id);
    setNodeToCenter(childNode.id);
    setPlusMenu(null);
    recalculatePaths();
  };

  const toggleCollapseStatus = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdateNodes((prevNodes) =>
      prevNodes.map(n => n.id === nodeId ? { ...n, collapsed: !n.collapsed } : n)
    );
    recalculatePaths();
  };

  const triggerReviewStatus = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdateNodes((prevNodes) =>
      prevNodes.map(n => n.id === nodeId ? { ...n, status: '审核中' } : n)
    );
  };

  const removeNodeFromCanvas = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdateNodes((prevNodes) => removeNodeAndRenumberIfNeeded(prevNodes, nodeId));
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
    recalculatePaths();
  };

  const startRenameAction = (nodeId: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingNodeId(nodeId);
    setRenameText(name);
  };

  const saveRenameAction = (nodeId: string) => {
    onUpdateNodes((prevNodes) =>
      prevNodes.map(n => n.id === nodeId ? { ...n, name: renameText.trim() || n.name } : n)
    );
    setEditingNodeId(null);
  };

  const updateChildPrompt = (nodeId: string, pText: string) => {
    onUpdateNodes((prevNodes) =>
      prevNodes.map(n => n.id === nodeId ? { ...n, prompt: pText } : n)
    );
  };

  const handleReviewSubmission = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdateNodes((prevNodes) => {
      const targetNode = prevNodes.find(n => n.id === nodeId);
      if (!targetNode || !targetNode.generated_media) return prevNodes;

      // Find root shot node functionally using prevNodes
      let shotNode: CanvasNode | null = null;
      let current = targetNode;
      while (current.parentId) {
        const parent = prevNodes.find(n => n.id === current.parentId);
        if (!parent) break;
        if (parent.type === '镜头') {
          shotNode = parent;
          break;
        }
        current = parent;
      }
      if (!shotNode) return prevNodes;

      const chainNodeIds: string[] = [];
      const traverse = (parentId: string) => {
        const children = prevNodes.filter(n => n.parentId === parentId);
        children.forEach(c => {
          chainNodeIds.push(c.id);
          traverse(c.id);
        });
      };
      traverse(shotNode.id);

      return prevNodes.map(n => {
        if (n.id === shotNode!.id) {
          return { ...n, generated_media: targetNode.generated_media };
        }
        if (chainNodeIds.includes(n.id)) {
          if (n.id === nodeId) {
            return { ...n, status: '审核中' };
          } else {
            return { ...n, status: n.status === '审核中' ? '草稿' : n.status };
          }
        }
        return n;
      });
    });
  };

  // Render Node box tree hierarchically using flex layout
  const renderNodeElement = (node: CanvasNode) => {
    const isEditing = editingNodeId === node.id;
    const isSelected = selectedNodeId === node.id;
    const isShotNode = node.type === '镜头';
    const childList = nodes.filter(n => n.parentId === node.id);
    const hasChildren = childList.length > 0;
    const resolvedRole = currentUserRole || 'USER';

    if (node.type === '镜头') {
      return (
        <div key={node.id} className="node-tree flex items-center relative select-none animate-in fade-in duration-300">
          <div
            id={`node-box-${node.id}`}
            className="z-10 relative group"
            data-testid="pipeline-canvas-node"
            data-node-id={node.id}
            data-node-type={node.type}
            data-node-name={node.name}
          >
            <ShotNode
              node={node}
              isSelected={isSelected}
              isEditing={isEditing}
              renameText={renameText}
              onRenameChange={setRenameText}
              onStartRename={(e) => startRenameAction(node.id, node.name, e)}
              onSaveRename={() => saveRenameAction(node.id)}
              onUpdate={(fields) => {
                onUpdateNodes((prevNodes) =>
                  prevNodes.map(n => n.id === node.id ? { ...n, ...fields } : n)
                );
              }}
              onDelete={(e) => removeNodeFromCanvas(node.id, e)}
              onSelect={(e) => {
                e.stopPropagation();
                setSelectedNodeId(node.id);
                setContextMenu(null);
              }}
            />
            
            {/* Action side buttons for spawning connected kids */}
            <div className="absolute -right-3 top-1/2 -translate-y-1/2 flex flex-col space-y-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50">
              {hasChildren && (
                <button
                  onClick={(e) => toggleCollapseStatus(node.id, e)}
                  className="w-6 h-6 bg-[#0a0a0a] text-white/70 border border-white/20 rounded-full flex items-center justify-center font-bold hover:scale-110 hover:text-white shadow-xl cursor-pointer"
                  title={node.collapsed ? '展开子节点' : '收起子节点'}
                >
                  <svg className={`w-3.5 h-3.5 transition-transform duration-250 ${node.collapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              )}

              <button
                onClick={(e) => handlePlusClick(node.id, e)}
                className="w-6 h-6 bg-green-500 text-black rounded-full flex items-center justify-center font-black hover:scale-110 shadow-xl cursor-pointer"
                title="选择并添加子节点"
              >
                +
              </button>
            </div>
          </div>
          {hasChildren && !node.collapsed && (
            <div className="node-children flex flex-col justify-center gap-6 pl-[60px] relative">
              {childList.map(child => renderNodeElement(child))}
            </div>
          )}
        </div>
      );
    }

    if (['图片生成', '角色', '场景', '道具', '氛围'].includes(node.type)) {
      return (
        <div key={node.id} className="node-tree flex items-center relative select-none animate-in fade-in duration-300">
          <div
            id={`node-box-${node.id}`}
            className="z-10 relative group"
            data-testid="pipeline-canvas-node"
            data-node-id={node.id}
            data-node-type={node.type}
            data-node-name={node.name}
          >
            <ImageGeneratorNode
              node={node}
              userRole={resolvedRole}
              isSelected={isSelected}
              apiConfigs={apiConfigs}
              currentProjectId={currentProjectId}
              productionStage={activeNode === '05' ? 'SHOT_04' : 'ART_03'}
              onUpdate={(fields) => {
                onUpdateNodes((prevNodes) => {
                  let updatedFields: Partial<CanvasNode> = {};
                  const updatedNodes = prevNodes.map(n => {
                    if (n.id !== node.id) return n;
                    updatedFields = typeof fields === 'function' ? fields(n) : fields;
                    return { ...n, ...updatedFields };
                  });
                  
                  if (updatedFields.generated_media !== undefined) {
                    const targetNode = updatedNodes.find(n => n.id === node.id);
                    if (targetNode) {
                      let shotNode: CanvasNode | null = null;
                      let current = targetNode;
                      while (current.parentId) {
                        const parent = updatedNodes.find(n => n.id === current.parentId);
                        if (!parent) break;
                        if (parent.type === '镜头') {
                          shotNode = parent;
                          break;
                        }
                        current = parent;
                      }
                      
                      if (shotNode) {
                        return updatedNodes.map(n => 
                          n.id === shotNode!.id 
                            ? { ...n, generated_media: updatedFields.generated_media! } 
                            : n
                        );
                      }
                    }
                  }
                  return updatedNodes;
                });
              }}
              onDelete={(e) => removeNodeFromCanvas(node.id, e)}
              onSubmitReview={(e) => handleReviewSubmission(node.id, e)}
              onSelect={(e) => {
                e.stopPropagation();
                setSelectedNodeId(node.id);
                setContextMenu(null);
              }}
            />
            
            {/* Action side buttons for spawning connected kids */}
            <div className="absolute -right-3 top-1/2 -translate-y-1/2 flex flex-col space-y-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50">
              {hasChildren && (
                <button
                  onClick={(e) => toggleCollapseStatus(node.id, e)}
                  className="w-6 h-6 bg-[#0a0a0a] text-white/70 border border-white/20 rounded-full flex items-center justify-center font-bold hover:scale-110 hover:text-white shadow-xl cursor-pointer"
                  title={node.collapsed ? '展开子节点' : '收起子节点'}
                >
                  <svg className={`w-3.5 h-3.5 transition-transform duration-250 ${node.collapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              )}

              <button
                onClick={(e) => handlePlusClick(node.id, e)}
                className="w-6 h-6 bg-cyan-400 text-black rounded-full flex items-center justify-center font-black hover:scale-110 shadow-xl cursor-pointer"
                title="选择并添加子节点"
              >
                +
              </button>
            </div>
          </div>
          {hasChildren && !node.collapsed && (
            <div className="node-children flex flex-col justify-center gap-6 pl-[60px] relative">
              {childList.map(child => renderNodeElement(child))}
            </div>
          )}
        </div>
      );
    }

    if (node.type === '视频生成') {
      return (
        <div key={node.id} className="node-tree flex items-center relative select-none animate-in fade-in duration-300">
          <div
            id={`node-box-${node.id}`}
            className="z-10 relative group"
            data-testid="pipeline-canvas-node"
            data-node-id={node.id}
            data-node-type={node.type}
            data-node-name={node.name}
          >
            <VideoGeneratorNode
              node={node}
              userRole={resolvedRole}
              isSelected={isSelected}
              apiConfigs={apiConfigs}
              currentProjectId={currentProjectId}
              productionStage="SHOT_04"
              onUpdate={(fields) => {
                onUpdateNodes((prevNodes) => {
                  let updatedFields: Partial<CanvasNode> = {};
                  const updatedNodes = prevNodes.map(n => {
                    if (n.id !== node.id) return n;
                    updatedFields = typeof fields === 'function' ? fields(n) : fields;
                    return { ...n, ...updatedFields };
                  });
                  
                  if (updatedFields.generated_media !== undefined) {
                    const targetNode = updatedNodes.find(n => n.id === node.id);
                    if (targetNode) {
                      let shotNode: CanvasNode | null = null;
                      let current = targetNode;
                      while (current.parentId) {
                        const parent = updatedNodes.find(n => n.id === current.parentId);
                        if (!parent) break;
                        if (parent.type === '镜头') {
                          shotNode = parent;
                          break;
                        }
                        current = parent;
                      }
                      
                      if (shotNode) {
                        return updatedNodes.map(n => 
                          n.id === shotNode!.id 
                            ? { ...n, generated_media: updatedFields.generated_media! } 
                            : n
                        );
                      }
                    }
                  }
                  return updatedNodes;
                });
              }}
              onDelete={(e) => removeNodeFromCanvas(node.id, e)}
              onSubmitReview={(e) => handleReviewSubmission(node.id, e)}
              onSelect={(e) => {
                e.stopPropagation();
                setSelectedNodeId(node.id);
                setContextMenu(null);
              }}
            />

            {/* Action side buttons for spawning connected kids */}
            <div className="absolute -right-3 top-1/2 -translate-y-1/2 flex flex-col space-y-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50">
              {hasChildren && (
                <button
                  onClick={(e) => toggleCollapseStatus(node.id, e)}
                  className="w-6 h-6 bg-[#0a0a0a] text-white/70 border border-white/20 rounded-full flex items-center justify-center font-bold hover:scale-110 hover:text-white shadow-xl cursor-pointer"
                  title={node.collapsed ? '展开子节点' : '收起子节点'}
                >
                  <svg className={`w-3.5 h-3.5 transition-transform duration-250 ${node.collapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              )}

              <button
                onClick={(e) => handlePlusClick(node.id, e)}
                className="w-6 h-6 bg-green-400 text-black rounded-full flex items-center justify-center font-black hover:scale-110 shadow-xl cursor-pointer"
                title="选择并添加子节点"
              >
                +
              </button>
            </div>
          </div>
          {hasChildren && !node.collapsed && (
            <div className="node-children flex flex-col justify-center gap-6 pl-[60px] relative">
              {childList.map(child => renderNodeElement(child))}
            </div>
          )}
        </div>
      );
    }

    if (node.type === 'scene3d' || node.type === '3D导演台') {
      return (
        <div key={node.id} className="node-tree flex items-center relative select-none animate-in fade-in duration-300">
          <div
            id={`node-box-${node.id}`}
            className="z-10 relative group"
            data-testid="pipeline-canvas-node"
            data-node-id={node.id}
            data-node-type={node.type}
            data-node-name={node.name}
          >
            <Scene3DNode
              node={node}
              isSelected={isSelected}
              currentProjectId={currentProjectId}
              availableImageSources={nodes
                .filter((candidate) => candidate.id !== node.id && Boolean(candidate.generated_media_asset_id && candidate.generated_media))
                .map((candidate) => ({
                  id: candidate.id,
                  label: candidate.name || candidate.type || candidate.id,
                  mediaAssetId: candidate.generated_media_asset_id!,
                  mediaUrl: candidate.generated_media!,
                  kind: 'upstream' as const
                }))}
              onUpdate={(fields) => {
                onUpdateNodes((prevNodes) => prevNodes.map(n => {
                  if (n.id !== node.id) return n;
                  const updatedFields = typeof fields === 'function' ? fields(n) : fields;
                  return { ...n, ...updatedFields };
                }));
              }}
              onCreateImageNode={({ capture }) => {
                onUpdateNodes((prevNodes) => {
                  const sourceNode = prevNodes.find(n => n.id === node.id);
                  if (!sourceNode || !capture.mediaUrl || !capture.mediaAssetId) return prevNodes;
                  const childNode: CanvasNode = {
                    id: `node_scene3d_image_${Date.now()}`,
                    name: '3D截图生图节点',
                    type: '图片生成',
                    x: sourceNode.x + 460,
                    y: sourceNode.y,
                    parentId: sourceNode.id,
                    collapsed: false,
                    status: '草稿',
                    prompt: '基于 3D导演台真实截图生成电影感参考帧，保持构图、机位和角色空间关系。',
                    model: '',
                    use_custom_api: false,
                    generated_media: capture.mediaUrl,
                    generated_media_asset_id: capture.mediaAssetId,
                    uploaded_images: [capture.mediaUrl],
                    imageInputs: {
                      referenceImageAssetIds: [capture.mediaAssetId]
                    },
                    aspect_ratio: sourceNode.aspect_ratio || '16:9',
                    resolution: '1K',
                    width: 1024,
                    height: 576,
                    num_outputs: 1,
                    style_preset: 'photorealistic',
                    negative_prompt: 'blurry, low quality, distorted anatomy, text defects',
                    cfg_scale: 7.5,
                    steps: 25,
                    seed: -1
                  };
                  return [...prevNodes, childNode];
                });
              }}
              onSendCaptureToCanvas={({ capture }) => {
                onUpdateNodes((prevNodes) => {
                  const sourceNode = prevNodes.find(n => n.id === node.id);
                  if (!sourceNode || !capture.mediaUrl || !capture.mediaAssetId) return prevNodes;
                  const childNode: CanvasNode = {
                    id: `node_scene3d_ref_${Date.now()}`,
                    name: '3D capture reference',
                    type: '图片生成',
                    x: sourceNode.x + 460,
                    y: sourceNode.y + 220,
                    parentId: sourceNode.id,
                    collapsed: false,
                    status: '草稿',
                    prompt: 'Use this Scene3D capture as a visual reference.',
                    model: '',
                    use_custom_api: false,
                    generated_media: capture.mediaUrl,
                    generated_media_asset_id: capture.mediaAssetId,
                    uploaded_images: [capture.mediaUrl],
                    imageInputs: { referenceImageAssetIds: [capture.mediaAssetId] },
                    aspect_ratio: sourceNode.aspect_ratio || capture.aspectRatio || '16:9',
                    resolution: '1K',
                    width: 1024,
                    height: 576,
                    num_outputs: 1,
                    style_preset: 'photorealistic',
                    negative_prompt: '',
                    cfg_scale: 7.5,
                    steps: 25,
                    seed: -1
                  };
                  return [...prevNodes, childNode];
                });
              }}
              onCreateVideoNode={({ capture }) => {
                onUpdateNodes((prevNodes) => {
                  const sourceNode = prevNodes.find(n => n.id === node.id);
                  if (!sourceNode || !capture.mediaUrl || !capture.mediaAssetId) return prevNodes;
                  const childNode: CanvasNode = {
                    id: `node_scene3d_video_${Date.now()}`,
                    name: '3D capture video node',
                    type: '视频生成',
                    x: sourceNode.x + 460,
                    y: sourceNode.y + 440,
                    parentId: sourceNode.id,
                    collapsed: false,
                    status: '草稿',
                    prompt: 'Animate this Scene3D capture into a short cinematic shot.',
                    model: '',
                    use_custom_api: false,
                    generated_media: capture.mediaUrl,
                    generated_media_asset_id: capture.mediaAssetId,
                    uploaded_images: [capture.mediaUrl],
                    video_generation_mode: 'image_to_video',
                    videoInputs: {
                      firstFrameAssetId: capture.mediaAssetId,
                      referenceImageAssetIds: [capture.mediaAssetId]
                    },
                    video_media_list: [{
                      url: capture.mediaUrl,
                      assetId: capture.mediaAssetId,
                      type: 'image',
                      name: capture.name
                    }],
                    aspect_ratio: sourceNode.aspect_ratio || capture.aspectRatio || '16:9',
                    video_resolution: '720p',
                    video_duration: 5,
                    generate_audio: false,
                    negative_prompt: 'blurry, low quality, distorted anatomy, text defects',
                    seed: -1
                  };
                  return [...prevNodes, childNode];
                });
              }}
              onCreateRecordedVideoNode={({ video, transition }) => {
                onUpdateNodes((prevNodes) => {
                  const sourceNode = prevNodes.find(n => n.id === node.id);
                  if (!sourceNode || !video.mediaUrl || !video.mediaAssetId) return prevNodes;
                  const childNode: CanvasNode = {
                    id: `node_scene3d_recorded_video_${Date.now()}`,
                    name: '3D导演台录制视频',
                    type: '视频生成',
                    x: sourceNode.x + 460,
                    y: sourceNode.y + 560,
                    parentId: sourceNode.id,
                    collapsed: false,
                    status: '已录制',
                    prompt: transition.actionPrompt || `3D导演台时间轴录制：${transition.name}`,
                    scene3dMotionPrompt: transition.actionPrompt || '',
                    model: '',
                    use_custom_api: false,
                    generated_media: video.mediaUrl,
                    generated_media_asset_id: video.mediaAssetId,
                    video_generation_mode: 'video_edit',
                    videoInputs: {
                      sourceVideoAssetId: video.mediaAssetId
                    },
                    video_media_list: [{
                      url: video.mediaUrl,
                      assetId: video.mediaAssetId,
                      type: 'video',
                      name: video.name,
                      duration: `${video.durationSec.toFixed(2)}s`,
                      durationMs: video.durationMs
                    }],
                    aspect_ratio: sourceNode.aspect_ratio || '16:9',
                    video_resolution: '720p',
                    video_duration: Math.max(1, Math.round(video.durationSec)),
                    generate_audio: false,
                    negative_prompt: '',
                    seed: -1
                  };
                  return [...prevNodes, childNode];
                });
              }}
              onCreateActionVideoNode={({ actionPlan, scene }) => {
                onUpdateNodes((prevNodes) => {
                  const sourceNode = prevNodes.find(n => n.id === node.id);
                  const actionKeyframes = Array.isArray(actionPlan.keyframes)
                    ? [...actionPlan.keyframes].sort((a, b) => (a.timeSec || 0) - (b.timeSec || 0))
                    : [];
                  const startCapture = (actionKeyframes[0] || actionPlan.startKeyframe)?.capture;
                  const endCapture = (actionKeyframes[actionKeyframes.length - 1] || actionPlan.endKeyframe)?.capture;
                  if (!sourceNode || !startCapture?.mediaUrl || !startCapture.mediaAssetId || !endCapture?.mediaUrl || !endCapture.mediaAssetId) return prevNodes;
                  const visualContext = {
                    sceneLights: scene?.sceneLights || [],
                    environmentMood: scene?.environmentMood || null,
                    materialDirectives: scene?.materialDirectives || [],
                    visualKeyframes: scene?.visualKeyframes || [],
                    aiDirectorPlan: actionPlan.aiDirectorPlan || null
                  };
                  const moodPrompt = actionPlan.aiDirectorPlan?.moodPrompt || scene?.environmentMood?.moodPreset || '';
                  const renderStylePrompt = actionPlan.aiDirectorPlan?.renderStylePrompt || [
                    scene?.environmentMood?.timeOfDay ? `time of day: ${scene.environmentMood.timeOfDay}` : '',
                    scene?.environmentMood?.weatherHint ? `weather: ${scene.environmentMood.weatherHint}` : '',
                    scene?.sceneLights?.length ? `${scene.sceneLights.length} directed Scene3D lights` : '',
                    scene?.materialDirectives?.length ? `${scene.materialDirectives.length} material directives` : ''
                  ].filter(Boolean).join(', ');
                  const childNode: CanvasNode = {
                    id: `node_scene3d_action_video_${Date.now()}`,
                    name: 'Scene3D first-last frame video',
                    type: '视频生成',
                    x: sourceNode.x + 460,
                    y: sourceNode.y + 660,
                    parentId: sourceNode.id,
                    collapsed: false,
                    status: '草稿',
                    prompt: actionPlan.generatedMotionPrompt || actionPlan.actionIntent || 'Animate a natural transition between the first and last Scene3D frames.',
                    scene3dMotionPrompt: actionPlan.generatedMotionPrompt || actionPlan.actionIntent || '',
                    scene3dMoodPrompt: moodPrompt,
                    scene3dRenderStylePrompt: renderStylePrompt,
                    scene3dVisualContext: visualContext,
                    model: '',
                    use_custom_api: false,
                    generated_media: startCapture.mediaUrl,
                    generated_media_asset_id: startCapture.mediaAssetId,
                    uploaded_images: [startCapture.mediaUrl, endCapture.mediaUrl],
                    video_generation_mode: 'first_last_frame',
                    videoInputs: {
                      firstFrameAssetId: startCapture.mediaAssetId,
                      lastFrameAssetId: endCapture.mediaAssetId,
                      referenceImageAssetIds: []
                    },
                    video_media_list: [
                      {
                        url: startCapture.mediaUrl,
                        assetId: startCapture.mediaAssetId,
                        type: 'image',
                        name: startCapture.name || 'Scene3D start frame'
                      },
                      {
                        url: endCapture.mediaUrl,
                        assetId: endCapture.mediaAssetId,
                        type: 'image',
                        name: endCapture.name || 'Scene3D end frame'
                      }
                    ],
                    aspect_ratio: sourceNode.aspect_ratio || startCapture.aspectRatio || endCapture.aspectRatio || '16:9',
                    video_resolution: '720p',
                    video_duration: 5,
                    generate_audio: false,
                    negative_prompt: 'blurry, low quality, distorted anatomy, inconsistent identity, mismatched final frame',
                    seed: -1
                  };
                  return [...prevNodes, childNode];
                });
              }}
              onDelete={(e) => removeNodeFromCanvas(node.id, e)}
              onSelect={(e) => {
                e.stopPropagation();
                setSelectedNodeId(node.id);
                setContextMenu(null);
              }}
            />

            <div className="absolute -right-3 top-1/2 -translate-y-1/2 flex flex-col space-y-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50">
              {hasChildren && (
                <button
                  onClick={(e) => toggleCollapseStatus(node.id, e)}
                  className="w-6 h-6 bg-[#0a0a0a] text-white/70 border border-white/20 rounded-full flex items-center justify-center font-bold hover:scale-110 hover:text-white shadow-xl cursor-pointer"
                  title={node.collapsed ? '展开子节点' : '收起子节点'}
                >
                  <svg className={`w-3.5 h-3.5 transition-transform duration-250 ${node.collapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              )}
              <button
                onClick={(e) => handlePlusClick(node.id, e)}
                className="w-6 h-6 bg-violet-400 text-black rounded-full flex items-center justify-center font-black hover:scale-110 shadow-xl cursor-pointer"
                title="选择并添加子节点"
              >
                +
              </button>
            </div>
          </div>
          {hasChildren && !node.collapsed && (
            <div className="node-children flex flex-col justify-center gap-6 pl-[60px] relative">
              {childList.map(child => renderNodeElement(child))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div key={node.id} className="node-tree flex items-center relative select-none">
        
        {/* Node Box */}
        <div
          id={`node-box-${node.id}`}
          data-testid="pipeline-canvas-node"
          data-node-id={node.id}
          data-node-type={node.type}
          data-node-name={node.name}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedNodeId(node.id);
            setContextMenu(null);
          }}
          className={`node-box glass-panel rounded-xl border flex flex-col z-10 group relative transition-all duration-300 ${
            isShotNode || node.type === '渲染' ? 'w-[420px]' : 'w-64'
          } ${
            isSelected
              ? 'border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.5)]'
              : 'border-white/10 shadow-2xl hover:border-white/20'
          }`}
        >
          {/* Header */}
          <div className="p-3 border-b border-white/5 flex justify-between items-center bg-white/5 relative">
            <span className="text-xs font-bold text-white tracking-widest flex items-center space-x-2">
              <div className={`w-1.5 h-1.5 rounded-full ${isShotNode ? 'bg-green-500' : (node.type === '渲染' ? 'bg-cyan-500 animate-pulse' : 'bg-blue-500')}`} />
              {isEditing ? (
                <input
                  type="text"
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={() => saveRenameAction(node.id)}
                  onKeyDown={(e) => e.key === 'Enter' && saveRenameAction(node.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-transparent border-b border-blue-500 text-white outline-none w-28 font-bold tracking-widest px-0.5"
                  autoFocus
                />
              ) : (
                <span
                  onDoubleClick={(e) => startRenameAction(node.id, node.name, e)}
                  className="cursor-text hover:text-blue-400 transition-colors"
                  title="双击重命名"
                >
                  {node.name}
                </span>
              )}
            </span>

            <div className="flex items-center space-x-1.5">
              {node.status && (
                <button
                  onClick={(e) => triggerReviewStatus(node.id, e)}
                  disabled={node.status === '审核中'}
                  className={`text-[9px] px-2 py-0.5 rounded border transition-colors select-none tracking-widest cursor-pointer font-bold ${
                    node.status === '审核中'
                      ? 'text-red-500 bg-red-500/10 border-red-500/30 shadow-[0_0_10px_rgba(239,68,68,0.2)] animate-pulse'
                      : 'text-gray-400 bg-white/5 border-white/10 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {node.status === '审核中' ? '审核中' : '提交审核'}
                </button>
              )}

              <button
                onClick={(e) => removeNodeFromCanvas(node.id, e)}
                className="text-gray-500 hover:text-white transition-colors cursor-pointer p-0.5 bg-white/5 rounded hover:bg-white/15"
                title="删除节点"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Node Body Card Contents */}
          <div className="p-3 flex-1">
            {isShotNode ? (
              <div className="w-full relative bg-black/30 rounded-lg p-3 flex flex-col border border-white/5 space-y-2">
                <div className="flex items-center space-x-1.5 text-green-400">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span className="text-[10px] font-mono tracking-wider uppercase font-bold">运镜与机位参数描述</span>
                </div>
                <div className="bg-[#121212]/80 rounded-lg border border-white/5 p-2">
                  <textarea
                    value={node.prompt || ''}
                    onChange={(e) => updateChildPrompt(node.id, e.target.value)}
                    className="w-full bg-transparent border-none text-white text-xs focus:outline-none resize-none h-20 placeholder-white/20 font-sans leading-relaxed custom-scrollbar"
                    placeholder="请输入镜头运动轨迹、机位角度、焦段等参数描述..."
                    data-testid="pipeline-canvas-node-prompt"
                    data-node-id={node.id}
                  />
                </div>
              </div>
            ) : (
              <div className="w-full relative bg-black/50 rounded-lg flex flex-col items-center justify-center border border-white/5 h-40 overflow-hidden group/thumb">
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/20 to-black/30 pointer-events-none" />
                <svg className="w-8 h-8 text-white/10 group-hover/thumb:text-white/25 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <button className="absolute top-3 right-3 bg-white/5 rounded px-2 py-0.5 text-[9px] border border-white/15 text-white/70">
                  默认资产
                </button>
              </div>
            )}
          </div>

          {/* Node Footer for Prompt Inputs */}
          {!isShotNode && node.type === '渲染' && node.prompt !== undefined && (
            <div className="p-2 pt-0 w-full">
              <div className="bg-[#1e1e1e] rounded-xl border border-white/5 p-3 flex flex-col space-y-2 shadow-inner">
                <textarea
                  value={node.prompt}
                  onChange={(e) => updateChildPrompt(node.id, e.target.value)}
                  className="w-full bg-transparent border-none text-white text-xs focus:outline-none resize-none h-10 placeholder-white/20 font-sans leading-relaxed"
                  placeholder="描述任何你想要渲染或生成的内容..."
                  data-testid="pipeline-canvas-node-prompt"
                  data-node-id={node.id}
                />
              </div>
            </div>
          )}

          {/* Action side buttons for recursion connections */}
          {true && (
            <div className="absolute -right-3 top-1/2 -translate-y-1/2 flex flex-col space-y-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-20">
              {hasChildren && (
                <button
                  onClick={(e) => toggleCollapseStatus(node.id, e)}
                  className="w-6 h-6 bg-[#0a0a0a] text-white/70 border border-white/20 rounded-full flex items-center justify-center font-bold hover:scale-110 hover:text-white shadow-xl cursor-pointer"
                  title={node.collapsed ? '展开子节点' : '收起子节点'}
                >
                  <svg className={`w-3.5 h-3.5 transition-transform duration-250 ${node.collapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              )}

              <button
                onClick={(e) => handlePlusClick(node.id, e)}
                className="w-6 h-6 bg-white text-black rounded-full flex items-center justify-center font-bold hover:scale-110 shadow-xl cursor-pointer"
                title="选择并添加子节点"
              >
                +
              </button>
            </div>
          )}
        </div>

        {/* Recursive Children Renders */}
        {hasChildren && !node.collapsed && (
          <div className="node-children flex flex-col justify-center gap-6 pl-[60px] relative">
            {childList.map(child => renderNodeElement(child))}
          </div>
        )}
      </div>
    );
  };

  const rootNodes = nodes.filter(n => !n.parentId);

  return (
    <div className="flex-1 relative overflow-hidden bg-[#030303]-base h-full w-full select-none">
      
      {/* Infinite Viewport */}
      <div
        ref={viewportRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleViewportDoubleClick}
        className="absolute inset-0 overflow-hidden canvas-bg cursor-move overflow-visible"
        style={{
          backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px)',
          backgroundSize: `${20 * scale}px ${20 * scale}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
          transition: isAnimatingPan ? 'background-position 0.5s cubic-bezier(0.25, 1, 0.5, 1)' : 'none'
        }}
      >
        {/* Transformable Canvas Content */}
        <div
          ref={contentRef}
          className="absolute top-0 left-0 origin-top-left flex flex-col space-y-16"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transition: isAnimatingPan ? 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)' : 'none',
            width: 'max-content',
            height: 'max-content'
          }}
        >
          {/* SVG Connection Paths Render Layer */}
          <svg className="absolute inset-0 overflow-visible pointer-events-none" style={{ zIndex: 0 }}>
            {paths.map((p, i) => (
              <path
                key={i}
                d={p.d}
                className={`fill-none transition-all duration-300 ${
                  p.active
                    ? 'stroke-blue-500 stroke-[2.5px] [stroke-dasharray:10_10] [animation:energy-flow-svg_0.5s_linear_infinite] [filter:drop-shadow(0_0_6px_rgba(59,130,246,0.8))]'
                    : 'stroke-white/15 stroke-[2px]'
                }`}
              />
            ))}
          </svg>

          {/* Root elements mapping */}
          {rootNodes.map(rootNode => renderNodeElement(rootNode))}
        </div>

        {/* Categories Spawning Context Menu */}
        {contextMenu && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="absolute z-50 w-40 bg-[#161616] border border-white/5 rounded-xl p-1.5 shadow-[0_10px_40px_rgba(0,0,0,0.8)] select-none animate-in fade-in zoom-in-95 duration-150"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <div className="px-3 py-2 text-[10px] text-gray-500 tracking-wider border-b border-white/5 mb-1 pb-2">
              {activeNode === '05' ? '添加流处理器' : '选择资产类目'}
            </div>
            {(activeNode === '05' 
              ? ['图片生成', '视频生成', '3D导演台'] 
              : ['角色', '场景', '道具', '氛围']
            ).map((category) => {
              const getDetails = (cat: string) => {
                switch (cat) {
                  case '角色': return { icon: '👤', color: 'text-blue-400' };
                  case '场景': return { icon: '🏞️', color: 'text-purple-400' };
                  case '道具': return { icon: '📦', color: 'text-yellow-400' };
                  case '氛围': return { icon: '✨', color: 'text-pink-400' };
                  case '3D导演台': return { icon: '🎥', color: 'text-violet-400' };
                  case '图片生成': return { icon: '🎨', color: 'text-cyan-400' };
                  case '视频生成': return { icon: '🎬', color: 'text-emerald-400' };
                  default: return { icon: '⚙️', color: 'text-zinc-400' };
                }
              };
              const details = getDetails(category);
              return (
                <div
                  key={category}
                  onClick={() => registerNewNodeFromMenu(category)}
                  className="flex items-center space-x-3 px-3 py-2 hover:bg-white/5 rounded-lg cursor-pointer transition-colors group"
                >
                  <div className={`w-5 h-5 rounded bg-white/5 flex items-center justify-center ${details.color}`}>
                    <span className="font-bold text-[10px]">{details.icon}</span>
                  </div>
                  <span className="text-xs text-white/90">{category}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Child Spawning Selection Popover Menu */}
        {plusMenu && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="absolute z-50 w-44 bg-[#161616] border border-white/10 rounded-xl p-1.5 shadow-[0_10px_40px_rgba(0,0,0,0.9)] select-none animate-in fade-in zoom-in-95 duration-150"
            style={{ left: plusMenu.x, top: plusMenu.y }}
          >
            <div className="px-3 py-2 text-[10px] text-gray-400 font-bold tracking-wider border-b border-white/5 mb-1 pb-2 uppercase text-center font-mono">
              选择衍生节点类型
            </div>
            {(activeNode === '05' 
              ? ['图片生成', '视频生成', '3D导演台'] 
              : ['角色', '场景', '道具', '氛围']
            ).map((category) => {
              const getDetails = (cat: string) => {
                switch (cat) {
                  case '角色': return { icon: '👤', color: 'text-blue-400' };
                  case '场景': return { icon: '🏞️', color: 'text-purple-400' };
                  case '道具': return { icon: '📦', color: 'text-yellow-400' };
                  case '氛围': return { icon: '✨', color: 'text-pink-400' };
                  case '3D导演台': return { icon: '🎥', color: 'text-violet-400' };
                  case '图片生成': return { icon: '🎨', color: 'text-cyan-400' };
                  case '视频生成': return { icon: '🎬', color: 'text-emerald-400' };
                  default: return { icon: '⚙️', color: 'text-zinc-400' };
                }
              };
              const details = getDetails(category);
              return (
                <div
                  key={category}
                  onClick={() => chooseAndSpawnChildNode(plusMenu.parentId, category)}
                  className="flex items-center space-x-3 px-3 py-2 hover:bg-white/5 rounded-lg cursor-pointer transition-colors group"
                >
                  <div className={`w-5 h-5 rounded bg-white/5 flex items-center justify-center ${details.color}`}>
                    <span className="font-bold text-[10px]">{details.icon}</span>
                  </div>
                  <span className="text-xs text-white/90 font-medium group-hover:text-white">{category}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Whiteboard Scale Widgets */}
        <div className="absolute bottom-6 left-6 glass-panel rounded-full flex items-center p-1.5 space-x-2 z-20 shadow-xl border border-white/5">
          <button
            onClick={() => { setScale(1); setPan({ x: 100, y: 150 }); }}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white"
            title="重置视图"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
          
          <div className="w-px h-4 bg-white/10" />

          <button
            onClick={() => setScale(prev => Math.max(0.2, prev - 0.1))}
            className="w-8 h-8 rounded-full hover:bg-white/5 flex items-center justify-center text-white/50 hover:text-white"
          >
            -
          </button>
          <span className="text-[10px] text-white/70 font-mono w-8 text-center select-none">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => setScale(prev => Math.min(3, prev + 0.1))}
            className="w-8 h-8 rounded-full hover:bg-white/5 flex items-center justify-center text-white/50 hover:text-white"
          >
            +
          </button>
        </div>
      </div>
      
      {/* Dynamic Keyframes Animation Injection */}
      <style>{`
        @keyframes energy-flow-svg {
          from { stroke-dashoffset: 20; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}
