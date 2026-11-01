function y=f3(x,t)
y = exp(-t).*sin(pi/4+pi/2.*x).*(pi^2/4.*exp(-4*t).*(sin(pi/4+pi/2*x)).^4-1);