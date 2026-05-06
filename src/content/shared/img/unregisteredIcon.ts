function createUnregisteredSVG(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '800px');
  svg.setAttribute('height', '800px');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '8');
  circle.setAttribute('cy', '8');
  circle.setAttribute('r', '6');
  circle.setAttribute('fill', 'none');
  circle.setAttribute('stroke', '#FF00FF');
  circle.setAttribute('stroke-width', '1.4');
  circle.setAttribute('opacity', '0.5');

  svg.appendChild(circle);
  return svg;
}

export function createUnregisteredIcon(): HTMLDivElement {
  const newDiv = document.createElement('div');
  newDiv.style.height = '1em';
  newDiv.style.width = '1em';
  newDiv.style.minWidth = '1em';
  newDiv.style.display = 'flex';
  newDiv.style.alignItems = 'center';
  newDiv.style.justifyContent = 'center';
  newDiv.style.marginLeft = '0.25em';

  const icon = createUnregisteredSVG();
  icon.style.height = '100%';
  icon.style.width = '100%';

  newDiv.appendChild(icon);
  return newDiv;
}
