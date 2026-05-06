function createRegisteredSVG(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '800px');
  svg.setAttribute('height', '800px');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '8');
  circle.setAttribute('cy', '8');
  circle.setAttribute('r', '6.5');
  circle.setAttribute('fill', '#FF00FF');

  const check = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  check.setAttribute('d', 'M4.8 8.2 L7 10.5 L11.6 5.6');
  check.setAttribute('stroke', '#FFFFFF');
  check.setAttribute('stroke-width', '1.6');
  check.setAttribute('fill', 'none');
  check.setAttribute('stroke-linecap', 'round');
  check.setAttribute('stroke-linejoin', 'round');

  svg.appendChild(circle);
  svg.appendChild(check);
  return svg;
}

export function createRegisteredIcon(): HTMLDivElement {
  const newDiv = document.createElement('div');
  newDiv.style.height = '1em';
  newDiv.style.width = '1em';
  newDiv.style.minWidth = '1em';
  newDiv.style.display = 'flex';
  newDiv.style.alignItems = 'center';
  newDiv.style.justifyContent = 'center';
  newDiv.style.marginLeft = '0.25em';

  const icon = createRegisteredSVG();
  icon.style.height = '100%';
  icon.style.width = '100%';

  newDiv.appendChild(icon);
  return newDiv;
}
