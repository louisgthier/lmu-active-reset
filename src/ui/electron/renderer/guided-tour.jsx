import React, { useLayoutEffect, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Icon } from "@iconify/react";
import arrowLeft from "@iconify-icons/solar/arrow-left-linear";
import arrowRight from "@iconify-icons/solar/arrow-right-linear";

export function GuidedTour({ saveKey, restoreKey, onTabChange, onFinish }) {
  const steps = [
    {
      target: "launch",
      title: "Open LMU for Active Reset",
      text: "Start a fresh offline session without EAC here, enter Offline Practice and DRIVE, then explicitly enable Active Reset. Disabling stops commands but requires closing LMU to remove the resident host. Restart through Steam before online play. This does not restore saved results or guarantee protection from bans.",
      side: "bottom",
    },
    {
      target: "checkpoint",
      title: "Save a moment. Try it again.",
      text: `In LMU, press ${saveKey} to save your car's state, then ${restoreKey} to return to it. A new save replaces the previous checkpoint.`,
      side: "bottom",
    },
    {
      target: "shortcuts",
      title: "Make the keys yours",
      text: "Click a shortcut, then press its new key. Choose unused game bindings. Return to LMU and release both keys before using them.",
      side: "top",
    },
    {
      target: "audio",
      title: "Hear the result",
      text: "Enable confirmation sounds for saves, restores and rejected commands. Use the play buttons to listen to each success sound.",
      side: "top",
    },
    {
      target: "connection",
      title: "Know when you’re connected",
      text: "Open offline Practice without EAC and enter driving. Sector connects automatically. Expand this bar to review status events, filter errors or export diagnostics.",
      side: "top",
    },
    {
      target: "settings",
      title: "Set your preferences",
      text: "Open Edit → Settings to change app settings. Reduce motion minimizes interface animations. Preferences are saved automatically.",
      side: "bottom",
    },
    {
      target: "overlay",
      title: "Build your HUD",
      text: "Choose widgets, toggle their parts and adjust size or opacity. Edit layout lets you drag and resize them on your display. Lock layout returns clicks to the game.",
      side: "bottom",
      tab: "overlay",
    },
    {
      target: "background",
      title: "Keep driving with Sector",
      text: "Close the window to choose background mode or quit. Background keeps shortcuts active; reopen Sector from the tray or launcher. Quit stops the listener safely.",
      side: "bottom",
    },
  ];
  const [index, setIndex] = useState(0);
  const [anchor, setAnchor] = useState(null);
  const nextButton = useRef(null);
  const step = steps[index];

  useLayoutEffect(() => {
    onTabChange(step.tab || "reset");
    let target;
    // Tabs mount their content after the selection update. Measure the actual
    // element so the arrow also follows scrolling, resizing and compact layouts.
    const frame = requestAnimationFrame(() => {
      target = document.querySelector(`[data-tour="${step.target}"]`);
      if (!target) return;
      target.scrollIntoView({
        block: "start",
        inline: "nearest",
        behavior: "instant",
      });
      target.dataset.tourActive = "true";
      setAnchor(target);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (target) delete target.dataset.tourActive;
    };
  }, [index, onTabChange, step.target, step.tab]);

  return (
    <Popover.Root
      open={Boolean(anchor)}
      modal
      onOpenChange={(open) => {
        if (!open) onFinish();
      }}
    >
      <Popover.Portal>
        <Popover.Backdrop className="tour-backdrop" />
        <Popover.Positioner
          className="tour-positioner"
          anchor={anchor}
          side={step.side}
          align="center"
          sideOffset={14}
          collisionPadding={16}
          collisionAvoidance={{ side: "shift", align: "shift" }}
          sticky
          positionMethod="fixed"
        >
          <Popover.Popup
            className="tour-popup"
            data-motion-step={index % 2}
            initialFocus={nextButton}
            finalFocus={() => document.querySelector(".guide-menu-trigger")}
          >
            <Popover.Arrow className="tour-arrow">
              <svg
                width="20"
                height="10"
                viewBox="0 0 20 10"
                aria-hidden="true"
              >
                <path d="M0 10 10 0 20 10" />
              </svg>
            </Popover.Arrow>
            <div aria-live="polite" aria-atomic="true">
              <span className="tour-progress">
                Quick guide, {index + 1} of {steps.length}
              </span>
              <Popover.Title>{step.title}</Popover.Title>
              <Popover.Description>{step.text}</Popover.Description>
            </div>
            <div className="tour-actions">
              <Popover.Close className="text-button">Skip</Popover.Close>
              <button
                className="secondary"
                aria-label="Previous step"
                disabled={index === 0}
                onClick={() => setIndex(index - 1)}
              >
                <Icon icon={arrowLeft} aria-hidden="true" />
              </button>
              <button
                className="primary"
                ref={nextButton}
                onClick={() =>
                  index === steps.length - 1 ? onFinish() : setIndex(index + 1)
                }
              >
                {index === steps.length - 1 ? "Finish" : "Next"}
                <Icon icon={arrowRight} aria-hidden="true" />
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
